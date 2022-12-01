import { DateTime } from 'luxon';
import { Helpers } from './helpers';
import { Log, LogInstance, Utils } from 'larvitutils';
import { Row, RowOptions } from './row';
import * as uuidLib from 'uuid';

const topLogPrefix = 'larvitorder: order.ts:';

type Fields = Record<string, string | string[]>;

export type OrderData = {
	uuid: string,

	/** Datetime in ISO-8601 */
	created: string,

	fields: Fields,
	rows: Row[],
}

export type OrderOptions = {
	db: any,
	log?: LogInstance,
	lUtils?: Utils,
	helpers?: Helpers,
} & Omit<Partial<OrderData>, 'rows'> & { rows?: RowOptions[] };

export class Order {
	private db: any;
	private log: LogInstance;
	private lUtils: Utils;
	private helpers: Helpers;

	public uuid!: string;
	public created!: string;
	public fields!: Fields;
	public rows!: Row[];

	constructor(options: OrderOptions) {
		if (!options.db) throw new Error('Required option db is missing');

		this.db = options.db;
		this.log = options.log ?? new Log();
		this.lUtils = options.lUtils ?? new Utils({ log: this.log });
		this.helpers = options.helpers ?? new Helpers({
			log: this.log,
			db: this.db,
			lUtils: this.lUtils,
		});

		this.init(options);
	}

	init(options: OrderOptions): void {
		const logPrefix = `${topLogPrefix} Order.prototype.init() -`;

		let uuid = options.uuid;
		if (!uuid) {
			uuid = uuidLib.v1();
			this.log.debug(`${logPrefix} New Order - Creating Order with uuid: ${uuid}`);
		} else {
			this.log.debug(`${logPrefix} Instanciating order with uuid: ${uuid}`);
		}

		this.uuid = uuid;
		// NOTE: DB table is setup to not store ms, set to 000
		this.created = options.created ?? DateTime.utc().startOf('second').toISO();

		this.fields = options.fields ?? {};
		this.rows ??= [];

		if (options.rows) {
			for (const row of options.rows) {
				this.rows.push({
					...row,
					uuid: row.uuid || uuidLib.v1(),
				});
			}
		}
	}

	async loadFromDb(): Promise<boolean> {
		const logPrefix = `${topLogPrefix} Order.loadFromDb() - uuid: "${this.uuid}" -`;
		const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);

		if (!uuidBuffer) {
			const err = new Error('Invalid order uuid');
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		// Get basic order data
		this.log.debug(`${logPrefix} Getting basic order data`);
		const { rows: dbOrders } = await this.db.query('SELECT * FROM orders WHERE uuid = ?', [uuidBuffer]);

		if (!dbOrders.length) {
			this.log.verbose(`${logPrefix} Could not find order with uuid: "${this.uuid}"`);

			return false;
		}

		this.uuid = this.helpers.formatUuid(dbOrders[0].uuid);
		const created = dbOrders[0].created;
		// Handle DB conf dateStrings being both true and false
		if (created instanceof Date) {
			this.created = DateTime
				.fromJSDate(created)
				.toUTC()
				.toISO();
		} else {
			// We do this extra conversion since mariadb returns non-ISO format
			this.created = `${created.replace(' ', 'T')}.000Z`;
		}

		// Get fields
		this.fields = await this.getOrderFields();

		// Get rows
		const orderRows = await this.getOrderRows();
		this.rows = orderRows;

		// Sort rows
		this.sortRows();

		return true;
	}

	async getOrderFields(): Promise<Fields> {
		const fields: Record<string, string[]> = {};

		const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);
		if (!uuidBuffer) {
			const err = new Error('Invalid order uuid');
			this.log.warn(`${topLogPrefix} getOrderFields() - ${err.message}`);
			throw err;
		}

		let sql = '';
		sql += 'SELECT orders_orderFields.name AS name, orders_orders_fields.fieldValue AS value\n';
		sql += 'FROM orders_orders_fields\n';
		sql += '  INNER JOIN orders_orderFields\n';
		sql += '    ON orders_orders_fields.fieldUuid = orders_orderFields.uuid\n';
		sql += 'WHERE orders_orders_fields.orderUuid = ?';

		const { rows } = await this.db.query(sql, [uuidBuffer]);
		for (const row of rows) {
			fields[row.name] ??= [];
			fields[row.name].push(row.value);
		}

		return fields;
	}

	async getOrderRows(): Promise<Row[]> {
		const rows: Row[] = [];
		const sorter: Record<string, Row> = {};

		const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);
		if (uuidBuffer === false) {
			const err = new Error('Invalid order uuid');
			this.log.warn(`${topLogPrefix} getOrderRows() - ${err.message}`);
			throw err;
		}

		let sql = '';
		sql += 'SELECT orders_rows.rowUuid AS uuid, orders_rows_fields.rowStrValue, orders_rows_fields.rowIntValue, orders_rowFields.name\n';
		sql += 'FROM orders_rows\n';
		sql += '  INNER JOIN orders_rows_fields\n';
		sql += '    ON orders_rows_fields.rowUuid = orders_rows.rowUuid\n';
		sql += '  INNER JOIN orders_rowFields\n';
		sql += '    ON orders_rowFields.uuid = orders_rows_fields.rowFieldUuid\n';
		sql += 'WHERE orders_rows.orderUuid = ?';

		const { rows: dbRows } = await this.db.query(sql, [uuidBuffer]);
		for (const dbRow of dbRows) {
			dbRow.uuid = this.helpers.formatUuid(dbRow.uuid);

			if (!sorter[dbRow.uuid]) {
				sorter[dbRow.uuid] = {
					uuid: dbRow.uuid,
				};
			}

			const value = dbRow.rowStrValue ?? dbRow.rowIntValue;
			sorter[dbRow.uuid][dbRow.name] ??= [];
			(sorter[dbRow.uuid][dbRow.name] as string[]).push(value);
		}

		for (const key in sorter) {
			rows.push(sorter[key]);
		}

		return rows;
	}

	async rm(): Promise<void> {
		const orderUuidBuf = this.lUtils.uuidToBuffer(this.uuid);
		if (!orderUuidBuf) {
			const err = new Error('Invalid order uuid');
			this.log.warn(`${topLogPrefix} rm() - ${err.message}`);
			throw err;
		}

		try {
			// Delete field data
			await this.db.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf]);

			// Delete row field data
			const { rows } = await this.db.query('SELECT rowUuid FROM orders_rows WHERE orderUuid = ?', [orderUuidBuf]);
			if (rows.length) {
				let sql = 'DELETE FROM orders_rows_fields WHERE rowUuid IN (';
				sql += rows.map(() => '?').join(',');
				sql += ')';

				await this.db.query(sql, rows.map((n: any) => n.rowUuid));
			}

			// Delete rows
			await this.db.query('DELETE FROM orders_rows WHERE orderUuid = ?', [orderUuidBuf]);

			// Delete order
			await this.db.query('DELETE FROM orders WHERE uuid = ?', [orderUuidBuf]);

			this.log.info(`${topLogPrefix} rm() - Removed order with UUID: "${this.uuid}"`);
		} catch (_err) {
			const err = _err as Error;
			this.log.warn(`${topLogPrefix} rm() - Error removing order with UUID: "${this.uuid}", err: ${err.message}`);
			throw err;
		}
	}

	// Saving the order object to the database using a diff.
	async save(): Promise<Order> {
		const logPrefix = `${topLogPrefix} save() -`;
		const orderFields = this.fields;
		const orderRows = this.rows;
		const orderUuid = this.uuid;
		const created = DateTime.fromISO(this.created);
		if (!created.isValid) throw new Error('created is not an valid ISO-8601 date');
		const createdUtc = created.toUTC().toISO(); // Always store in UTC
		const orderUuidBuf = this.lUtils.uuidToBuffer(orderUuid);
		const uniqueUpdateRowUuids = [];

		if (this.lUtils.formatUuid(orderUuid) === false || typeof orderUuidBuf === 'boolean') {
			const err = new Error('Invalid orderUuid: "' + orderUuid + '"');
			this.log.error(`${logPrefix} ${err.message}`);
			throw err;
		}

		// Get all field uuids
		const fieldUuidsByName = await this.helpers.getOrderFieldUuids(Object.keys(orderFields));

		// Get all row field uuids and make sure all rows got an uuid
		const rowFieldNames: string[] = [];
		for (let i = 0; i < orderRows.length; i++) {
			const row = orderRows[i];

			row.uuid = row.uuid || uuidLib.v4();

			// Set sortOrder on rows to maintain order independent of storage engine
			row.sortOrder = i;

			for (const rowFieldName of Object.keys(row)) {
				if (!rowFieldNames.includes(rowFieldName)) {
					rowFieldNames.push(rowFieldName);
				}
			}
		}

		const rowFieldUuidsByName = await this.helpers.getRowFieldUuids(rowFieldNames);

		// Get a database connection
		const dbCon = await this.db.getConnection();

		try {
			// Make sure the base order row exists
			await dbCon.query('INSERT IGNORE INTO orders (uuid, created) VALUES(?,?)', [orderUuidBuf, createdUtc]);

			// Begin transaction
			await dbCon.beginTransaction();

			// Clean out old field data
			await dbCon.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf]);

			// Insert fields
			const dbFields = [];
			let sql = 'INSERT INTO orders_orders_fields (orderUuid, fieldUuid, fieldValue) VALUES';

			for (const fieldName of Object.keys(orderFields)) {
				if (!Array.isArray(orderFields[fieldName])) {
					orderFields[fieldName] = [orderFields[fieldName] as unknown as string];
				}

				for (const fieldValue of orderFields[fieldName]) {
					if (fieldValue === null || fieldValue === undefined) continue;

					sql += '(?,?,?),';
					dbFields.push(orderUuidBuf);
					dbFields.push(fieldUuidsByName[fieldName]);
					dbFields.push(fieldValue);
				}
			}

			sql = sql.substring(0, sql.length - 1) + ';';

			if (dbFields.length) {
				await dbCon.query(sql, dbFields);
			}

			// Get rows to update
			const { changedRows: updateRows, removeRows } = await this.helpers.getChangedRows(dbCon, orderUuidBuf, this.rows, rowFieldUuidsByName);

			// Get unique rowUuids from updateRows
			const seen: Record<string, boolean> = {};
			let j = 0;
			for (const row of updateRows) {
				if (!seen[row.rowUuid]) {
					seen[row.rowUuid] = true;
					uniqueUpdateRowUuids[j++] = { rowUuid: row.rowUuid, rowUuidBuff: row.rowUuidBuff };
				}
			}

			// Clean out changed orders_rows_fields
			if (uniqueUpdateRowUuids.length || removeRows.length) {
				let sql = 'DELETE FROM orders_rows_fields WHERE rowUuid IN (';

				if (uniqueUpdateRowUuids.length) {
					sql += uniqueUpdateRowUuids.map(() => '?').join(',');
				}

				if (removeRows.length) {
					if (uniqueUpdateRowUuids.length) {
						sql += ',';
					}

					sql += removeRows.map(() => '?').join(',');
				}

				sql += ')';

				await dbCon.query(sql, [...uniqueUpdateRowUuids.map(x => x.rowUuidBuff), ...removeRows.map(x => x.rowUuidBuff)]);
			}

			// Clean out changed orders_rows
			if (uniqueUpdateRowUuids.length || removeRows.length) {
				let sql = 'DELETE FROM orders_rows WHERE orderUuid = ? AND rowUuid IN (';

				if (uniqueUpdateRowUuids.length) {
					sql += uniqueUpdateRowUuids.map(() => '?').join(',');
				}

				if (removeRows.length) {
					if (uniqueUpdateRowUuids.length) {
						sql += ',';
					}

					sql += removeRows.map(() => '?').join(',');
				}

				sql += ')';

				await dbCon.query(sql, [orderUuidBuf, ...uniqueUpdateRowUuids.map(x => x.rowUuidBuff), ...removeRows.map(x => x.rowUuidBuff)]);
			}

			// Insert rows
			if (uniqueUpdateRowUuids.length) {
				const dbFields = [];
				let sql = 'INSERT INTO orders_rows (rowUuid, orderUuid) VALUES';

				for (const rowUuid of uniqueUpdateRowUuids.map(x => x.rowUuidBuff)) {
					sql += '(?,?),';
					dbFields.push(rowUuid);
					dbFields.push(orderUuidBuf);
				}

				sql = sql.substring(0, sql.length - 1);

				if (dbFields.length) {
					await dbCon.query(sql, dbFields);
				}
			}

			// Insert row fields
			if (updateRows.length) {
				const dbFields = [];
				let sql = 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUES';

				for (const updateRow of updateRows) {
					for (const rowFieldName of Object.keys(updateRow.row)) {
						if (rowFieldName === 'uuid') continue;

						updateRow.row[rowFieldName] = this.helpers.arrayify(updateRow.row[rowFieldName]) ?? [];
						for (const rowFieldValue of updateRow.row[rowFieldName] as (string | number)[]) {
							if (rowFieldValue === undefined || rowFieldValue === null) continue;

							sql += '(?,?,?,?),';
							dbFields.push(updateRow.rowUuidBuff);
							dbFields.push(rowFieldUuidsByName[rowFieldName]);

							if (this.helpers.isNumberIsh(rowFieldValue)) {
								dbFields.push(rowFieldValue);
								dbFields.push(null);
							} else {
								dbFields.push(null);
								dbFields.push(rowFieldValue);
							}
						}
					}
				}

				sql = sql.substring(0, sql.length - 1) + ';';

				if (dbFields.length) {
					await dbCon.query(sql, dbFields);
				}
			}

			await dbCon.commit();
		} catch (_err) {
			const err = _err as Error;

			// Rollback transaction
			await dbCon?.rollback();

			this.log.error(`${logPrefix} failed to save order with UUID "${orderUuid}", err: ${err.message}`);
			throw err;
		} finally {
			// Always release connection
			await dbCon?.release();
		}

		// Clean out sortOrder row field
		for (let i = 0; i < orderRows.length; i++) {
			const row = orderRows[i];
			delete row.sortOrder;
		}

		this.log.info(`${logPrefix} Saved order with UUID: "${orderUuid}"`);

		return this;
	}

	// Sorting rows on the row field "sortOrder" if it exists
	sortRows(): void {
		if (!this.rows?.length) return;

		this.rows.sort((a, b) => {
			const ax = Number(Array.isArray(a.sortOrder) ? a.sortOrder[0] : a.sortOrder);
			const bx = Number(Array.isArray(b.sortOrder) ? b.sortOrder[0] : b.sortOrder);

			if (ax === bx) return 0;

			if (isNaN(ax) && !isNaN(bx)) return 1;
			if (isNaN(bx) && !isNaN(ax)) return -1;

			return ax - bx;
		});

		// Remove all sortOrder fields
		for (let i = 0; this.rows[i] !== undefined; i++) {
			delete this.rows[i].sortOrder;
		}
	}
}
