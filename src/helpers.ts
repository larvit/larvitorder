import * as uuidLib from 'uuid';
import { LogInstance, Utils } from 'larvitutils';
import { Row } from './row';

const topLogPrefix = 'larvitorder: helpers.ts:';

type CachedField = {
	name: string,
	uuid: string,
};

type HelperOptions = {
	db: any,
	log: LogInstance,
	lUtils: Utils,
};

export type GetFieldValuesOptions = {
	fieldName: string,
	matchAllFields?: Record<string, string | Array<string>>
} | string;

export class Helpers {
	private db: any;
	private log: LogInstance;
	private lUtils: Utils;

	private cachedOrderFields: Array<CachedField> = [];
	private cachedRowFields: Array<CachedField> = [];

	constructor(options: HelperOptions) {
		if (!options.db) throw new Error('Missing required option "db"');
		if (!options.log) throw new Error('Missing required option "log"');
		if (!options.lUtils) throw new Error('Missing required option "lUtils"');

		this.db = options.db;
		this.log = options.log;
		this.lUtils = options.lUtils;
	}

	async getFieldValues(options: GetFieldValuesOptions): Promise<string[]> {
		if (typeof options === 'string') {
			options = { fieldName: options };
		}

		const dbFields = [];

		let sql = 'SELECT DISTINCT fieldValue\n';
		sql += 'FROM orders_orders_fields\n';
		sql += 'WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?)\n';
		dbFields.push(options.fieldName);

		if (options.matchAllFields) {
			for (const fieldName in options.matchAllFields) {
				dbFields.push(fieldName);
				sql += 'AND orderUuid IN (\n';
				sql += 'SELECT orderUuid\n';
				sql += 'FROM orders_orders_fields\n';
				if (Array.isArray(options.matchAllFields[fieldName])) {
					sql += 'WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue IN (';
					for (let i = 0; i < options.matchAllFields[fieldName].length; i++) {
						dbFields.push(options.matchAllFields[fieldName][i]);
						sql += '?,';
					}
					sql = sql.substring(0, sql.length - 1);
					sql += ')\n';
				} else {
					dbFields.push(options.matchAllFields[fieldName]);
					sql += 'WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue = ?\n';
				}

				sql += ')';
			}
		}
		sql += 'ORDER BY fieldValue;';

		const { rows } = await this.db.query(sql, dbFields);
		const names: string[] = rows.map((r: any) => r.fieldValue);

		return names;
	}

	async getOrderFieldUuid(fieldName: string): Promise<string> {
		const cachedOrderField = this.cachedOrderFields.find(field => field.name === fieldName);
		if (cachedOrderField) return cachedOrderField.uuid;

		// If we get down here, the field does not exist, create it and rerun
		const uuid = uuidLib.v1();
		// NOTE: uuid is inserted as string here, it will be trunkated. Keep it as is for now to not break existing stuff.
		await this.db.query('INSERT IGNORE INTO orders_orderFields (uuid, name) VALUES(?,?)', [uuid, fieldName]);
		await this.loadOrderFieldsToCache();

		return await this.getOrderFieldUuid(fieldName);
	}

	async getOrderFieldUuids(fieldNames: string[]): Promise<Record<string, string>> {
		const fieldUuidsByName: Record<string, string> = {};

		for (const fieldName of fieldNames) {
			fieldUuidsByName[fieldName] = await this.getOrderFieldUuid(fieldName);
		}

		return fieldUuidsByName;
	}

	async getRowFieldUuid(rowFieldName: string): Promise<string> {
		const logPrefix = `${topLogPrefix} getRowFieldUuid() -`;

		if (rowFieldName === 'uuid') {
			const err = new Error('Row field "uuid" is reserved and have no uuid');
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		const cachedField = this.cachedRowFields.find(field => field.name === rowFieldName);
		if (cachedField) return cachedField.uuid;

		// If we get down here, the field does not exist, create it and rerun
		const uuid = uuidLib.v1();
		// NOTE: uuid is inserted as string here, it will be trunkated. Keep it as is for now to not break existing stuff.
		await this.db.query('INSERT IGNORE INTO orders_rowFields (uuid, name) VALUES(?,?)', [uuid, rowFieldName]);
		await this.loadRowFieldsToCache();

		return await this.getRowFieldUuid(rowFieldName);
	}

	async getRowFieldUuids(rowFieldNames: string[]): Promise<Record<string, string>> {
		const rowFieldUuidsByName: Record<string, string> = {};

		for (const rowFieldName of rowFieldNames) {
			if (rowFieldName === 'uuid') continue; // Ignore uuid

			const fieldUuid = await this.getRowFieldUuid(rowFieldName);
			rowFieldUuidsByName[rowFieldName] = fieldUuid;
		}

		return rowFieldUuidsByName;
	}

	async loadOrderFieldsToCache(): Promise<void> {
		const { rows } = await this.db.query('SELECT * FROM orders_orderFields ORDER BY name;');
		this.cachedOrderFields = rows;
	}

	async loadRowFieldsToCache(): Promise<void> {
		const { rows } = await this.db.query('SELECT * FROM orders_rowFields ORDER BY name;');
		this.cachedRowFields = rows;
	}

	isBufferEqual(b1: Buffer | string, b2: Buffer | string): boolean {
		if (b1.length !== b2.length) return false;

		for (let i = 0; i < b1.length; i++) {
			if (b1[i] !== b2[i]) return false;
		}

		return true;
	}

	formatUuid(uuid: string | Buffer): string {
		const uuidStr = this.lUtils.formatUuid(uuid);
		if (typeof uuidStr === 'boolean') throw new Error(`Failed to format uuid: "${uuid.toString()}"`);

		return uuidStr;
	}

	uuidToBuffer(uuid: string): Buffer {
		const uuidBuf = this.lUtils.uuidToBuffer(uuid);
		if (typeof uuidBuf === 'boolean') throw new Error(`Failed to convert uuid to buffer, uuid: "${uuid}"`);

		return uuidBuf;
	}

	arrayify<T>(value: T | T[] | undefined): T[] | undefined {
		if (value === undefined) return undefined;

		return Array.isArray(value) ? value : [value];
	}

	// This is only giving true for positive (including 0) integers, keps this way for backwards compatibility
	isNumberIsh(value: string | number): boolean {
		return typeof value === 'number' && (value % 1) === 0;
	}

	isDateIsh(value: string): boolean {
		// value is a string representation of a date and time (e.g. "2021-01-01 00:00:00")
		// This function checks if the string is a valid date and time
		return !isNaN(Date.parse(value));
	}

	async getChangedRows(
		dbCon: any,
		orderUuidBuf: Buffer,
		orderRows: Row[],
		rowFieldUuidsByName: Record<string, string>,
	): Promise<{
		changedRows: Array<{ rowUuid: string, rowUuidBuff: Buffer, row: Row }>,
		removeRows: Array<{ rowUuid: string, rowUuidBuff: Buffer }>,
	}> {
		// Get order rows
		const { rows: dbRows } = await dbCon.query('SELECT rowUuid FROM orders_rows WHERE orderUuid = ?', [orderUuidBuf]);

		// Get order row data
		const orderRowDataQuery = 'SELECT \n' +
			'rowUuid, \n' +
			'rowFieldUuid, \n' +
			'rowIntValue, \n' +
			'rowStrValue\n' +
			'FROM orders_rows_fields \n' +
			'WHERE rowUuid IN ( \n' +
				'SELECT rowUuid FROM orders_rows WHERE orderUuid = ? \n' +
			')';

		const { rows: dbOrderRowData } = await dbCon.query(orderRowDataQuery, [orderUuidBuf]);

		// Compare data and remove untouched rows
		const changedRows: Array<{ rowUuid: string, rowUuidBuff: Buffer, row: Row }> = [];
		const removeRows: Array<{ rowUuid: string, rowUuidBuff: Buffer }> = [];

		for (const dbRowUuidBuff of dbRows.map((x: any) => x.rowUuid)) {
			const dbRowUuid = this.formatUuid(dbRowUuidBuff);

			if (!orderRows.map(x => x.uuid).includes(dbRowUuid)) {
				removeRows.push({ rowUuid: dbRowUuid, rowUuidBuff: dbRowUuidBuff });
			}
		}

		let rowAdded = false;
		for (const row of orderRows) {
			if (!row.uuid) {
				throw new Error('Row is missing uuid, make sure it has been set before calling getChangedRows()');
			}

			const rowUuidBuff = this.uuidToBuffer(row.uuid);

			const foundDbRows = dbOrderRowData.filter((x: any) => this.isBufferEqual(x.rowUuid, rowUuidBuff));

			if (!foundDbRows.length) {
				// New row.
				changedRows.push({ rowUuid: row.uuid, rowUuidBuff: rowUuidBuff, row: row });
				rowAdded = true;

				continue;
			}

			rowAdded = false;

			for (const rowFieldName of Object.keys(row)) {
				if (rowAdded) break;

				if (rowFieldName === 'uuid') continue;

				const foundRowsByField = foundDbRows.filter((x: any) => this.isBufferEqual(x.rowFieldUuid, rowFieldUuidsByName[rowFieldName]));

				if (!foundRowsByField.length) {
					// New row.
					changedRows.push({ rowUuid: row.uuid, rowUuidBuff: rowUuidBuff, row: row });
					rowAdded = true;

					break;
				}

				row[rowFieldName] = this.arrayify(row[rowFieldName]) ?? [];
				for (const rowFieldValue of row[rowFieldName] as (string | number)[]) {
					if (rowAdded) break;

					let intValue: number;
					let strValue: string;

					if (this.isNumberIsh(rowFieldValue)) {
						intValue = rowFieldValue as number;
					} else {
						strValue = String(rowFieldValue);
					}

					if (!foundRowsByField.find((x: any) => x.rowIntValue === (intValue !== undefined ? intValue : null)
						&& x.rowStrValue === (strValue !== undefined ? strValue : null))) {
						// Changed row.
						changedRows.push({ rowUuid: row.uuid, rowUuidBuff: rowUuidBuff, row: row });
						rowAdded = true;

						break;
					}
				}
			}
		}

		return { changedRows, removeRows };
	}
}
