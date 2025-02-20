import { Log, LogInstance, Utils } from 'larvitutils';
import { Helpers } from './helpers';
import { OrderData } from './order';

export type matchDate = {
	field: string,
	value: string,
	operation?: 'gt' | 'lt' | 'eq',
};

export type OrdersOptions = {
	db: any,
	log: LogInstance,
	lUtils?: Utils,
	helpers?: Helpers,

	uuids?: string | string[],
	matchDates?: matchDate[],
	matchFieldDates?: matchDate[],
	createdAfter?: string,
	updatedAfter?: string,
	matchFieldHasValue?: string[],
	matchFieldHasNoValue?: string[],
	q?: string,
	matchAllFields?: Record<string, string | string[]>,
	fieldNotEqualTo?: Record<string, string>,
	fieldGreaterThanOrEqualTo?: Record<string, string | number>,
	fieldLessThanOrEqualTo?: Record<string, string | number>,
	matchAllRowFields?: Record<string, string | number>,
	limit?: number | string,
	offset?: number | string,
	returnFields?: string[],
	returnRowFields?: string[],
};

export class Orders {
	private db: any;
	private dbCon: any;
	private log: LogInstance;
	private lUtils: Utils;
	private helpers: Helpers;

	public uuids?: string[];
	public matchDates?: matchDate[];
	public matchFieldDates?: matchDate[];
	public createdAfter?: string;
	public updatedAfter?: string;
	public matchFieldHasValue?: string[];
	public matchFieldHasNoValue?: string[];
	public q?: string;
	public matchAllFields?: Record<string, string | string[]>;
	public fieldNotEqualTo?: Record<string, string>;
	public fieldGreaterThanOrEqualTo?: Record<string, string | number>;
	public fieldLessThanOrEqualTo?: Record<string, string | number>;
	public matchAllRowFields?: Record<string, string | number>;
	public limit?: number | string;
	public offset?: number | string;
	public returnFields?: string[];
	public returnRowFields?: string[];

	constructor(options?: OrdersOptions) {
		if (!options?.db) throw new Error('Missing required option "db"');

		this.db = options.db;
		this.log = options.log ?? new Log();
		this.lUtils = options.lUtils ?? new Utils();
		this.helpers = options.helpers ?? new Helpers({
			db: this.db,
			log: this.log,
			lUtils: this.lUtils,
		});

		this.uuids = this.helpers.arrayify(options.uuids);
		this.matchDates = options.matchDates;
		this.matchFieldDates = options.matchFieldDates;
		this.createdAfter = options.createdAfter;
		this.updatedAfter = options.updatedAfter;
		this.matchFieldHasValue = options.matchFieldHasValue;
		this.matchFieldHasNoValue = options.matchFieldHasNoValue;
		this.q = options.q;
		this.matchAllFields = options.matchAllFields;
		this.fieldNotEqualTo = options.fieldNotEqualTo;
		this.fieldGreaterThanOrEqualTo = options.fieldGreaterThanOrEqualTo;
		this.fieldLessThanOrEqualTo = options.fieldLessThanOrEqualTo;
		this.matchAllRowFields = options.matchAllRowFields;
		this.limit = options.limit;
		this.offset = options.offset;
		this.returnFields = options.returnFields;
		this.returnRowFields = options.returnRowFields;
	}

	async get(): Promise<{ orders: Record<string, OrderData>, hits: number }> {
		// Get basic orders and total hits
		const { orders, hits } = await this.getBasicOrders();

		// Get fields
		await this.getAndPopulateOrderFields(orders);

		// Get rows
		await this.getAndPopulateOrderRows(orders);

		return { orders, hits };
	}

	private async getBasicOrders(): Promise<{ orders: Record<string, OrderData>, hits: number }> {
		const orders: Record<string, OrderData> = {};

		// Create sql with filters
		let sql = ' FROM orders WHERE 1';
		let dbFields: (string | number | Buffer)[] = [];

		({ sql, dbFields } = this.concatSqlUuidsFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlCreatedAfterFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlUpdatedAfterFilter(sql, dbFields));
		({ sql, dbFields } = await this.concatSqlDateFilter(sql, dbFields));
		({ sql, dbFields } = await this.concatSqlFieldDateFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlQFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlMatchAllFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlFieldNotEqualToFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlFieldGreaterThanOrEqualToFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlFieldLessThanOrEqualToFilter(sql, dbFields));
		({ sql, dbFields } = this.concatSqlFieldHasValue(sql, dbFields));
		({ sql, dbFields } = this.concatSqlFieldHasNoValue(sql, dbFields));
		({ sql, dbFields } = this.concatSqlMatchAllRowsFieldsFilter(sql, dbFields));
		sql += ' ORDER BY created DESC';

		// Hits sql without limit and offset
		const hitsSql = 'SELECT COUNT(*) AS hits' + sql;

		// Finalize sql with limit, offset and select
		sql = this.concatSqlLimitAndOffset(sql);
		sql = 'SELECT *' + sql;

		// Query db
		let hits = 0;
		const queryOrders = async (): Promise<void> => {
			const { rows } = await this.db.query(sql, dbFields);
			for (const row of rows) {
				const uuid = this.helpers.formatUuid(row.uuid);
				orders[uuid] = {
					uuid,
					created: row.created,
					updated: row.updated,
					fields: {},
					rows: [],
				};
			}
		};

		const queryOrderCount = async (): Promise<void> => {
			const { rows } = await this.db.query(hitsSql, dbFields);
			hits = rows[0].hits;
		};

		await Promise.all([queryOrders(), queryOrderCount()]);

		return { orders, hits };
	}


	private concatSqlUuidsFilter(
		sql: string,
		dbFields: (string | number | Buffer)[],
	): {
		sql: string,
		dbFields: (string | number | Buffer)[]
	} {
		if (!this.uuids) return { sql, dbFields };

		// Match nothing if uuids is empty array
		if (!this.uuids.length) {
			sql += ' AND 0';

			return { sql, dbFields };
		}

		// Match against uuids
		sql += ' AND uuid IN (';
		for (const uuid of this.uuids) {
			const buffer = this.helpers.uuidToBuffer(uuid);

			sql += '?,';
			dbFields.push(buffer);
		}

		sql = sql.substring(0, sql.length - 1) + ')';

		return { sql, dbFields };
	}

	private concatSqlCreatedAfterFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (!this.createdAfter) return { sql, dbFields };

		if (!this.helpers.isDateIsh(this.createdAfter)) {
			sql += ' AND created IS NULL';

			return { sql, dbFields };
		}

		sql += ' AND created >= ?';
		dbFields.push(this.createdAfter);

		return { sql, dbFields };
	}

	private concatSqlUpdatedAfterFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (!this.updatedAfter) return { sql, dbFields };

		if (!this.helpers.isDateIsh(this.updatedAfter)) {
			sql += ' AND created IS NULL';

			return { sql, dbFields };
		}

		sql += ' AND updated >= ?';
		dbFields.push(this.updatedAfter);

		return { sql, dbFields };
	}

	private async concatSqlDateFilter(sql: string, dbFields: (string | number | Buffer)[]): Promise<ReturnType<typeof this.concatSqlUuidsFilter>> {
		if (!this.matchDates || !this.matchDates.length) return { sql, dbFields };

		const dbCon = await this.db.getConnection();

		try {
			// Check headerDates
			for (const matchExistingDate of this.matchDates) {
				const operation = matchExistingDate.operation || 'eq';
				const value = matchExistingDate.value;
				const field = matchExistingDate.field;
				if (!value) continue;
				if (!field) continue;
				if (['eq', 'gt', 'lt'].indexOf(operation) === -1) continue;

				sql += ' AND ' + dbCon.escapeId(field);

				if (operation === 'eq') sql += ' = CAST(? AS DATETIME)\n';
				else if (operation === 'gt') sql += ' > CAST(? AS DATETIME)\n';
				else if (operation === 'lt') sql += ' < CAST(? AS DATETIME)\n';

				dbFields.push(value);
			}
		} finally {
			dbCon.release();
		}

		return { sql, dbFields };
	}

	private async concatSqlFieldDateFilter(sql: string, dbFields: (string | number | Buffer)[]): Promise<ReturnType<typeof this.concatSqlUuidsFilter>> {
		if (!this.matchFieldDates || !this.matchFieldDates.length) return { sql, dbFields };

		// Check field dates
		for (const matchExistingDate of this.matchFieldDates) {
			const operation = matchExistingDate.operation || 'eq';
			const value = matchExistingDate.value;
			const field = matchExistingDate.field;
			if (!value) continue;
			if (!field) continue;
			if (['eq', 'gt', 'lt'].indexOf(operation) === -1) continue;

			dbFields.push(field);
			dbFields.push(value);

			sql += ' AND orders.uuid IN (\n';
			sql += '  SELECT DISTINCT orderUuid\n';
			sql += '  FROM orders_orders_fields\n';
			sql += '  WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?)\n';

			if (operation === 'eq') sql += '  AND CAST(fieldValue AS DATETIME) = CAST(? AS DATETIME)\n';
			else if (operation === 'gt') sql += '  AND CAST(fieldValue AS DATETIME) > CAST(? AS DATETIME)\n';
			else if (operation === 'lt') sql += '  AND CAST(fieldValue AS DATETIME) < CAST(? AS DATETIME)\n';

			sql += ')';
		}

		return { sql, dbFields };
	}

	private concatSqlQFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (this.q === undefined) {
			return { sql, dbFields };
		}

		sql += ' AND (\n';
		sql += '  (\n';
		sql += '    uuid IN (SELECT DISTINCT orderUuid FROM orders_orders_fields WHERE MATCH (fieldValue) AGAINST (?))\n';
		sql += '  )\n';
		dbFields.push('"' + this.q + '"');

		sql += ' OR uuid IN (\n';
		sql += '  SELECT DISTINCT orderUuid\n';
		sql += '  FROM orders_rows WHERE rowUuid IN (\n';
		sql += '    SELECT rowUuid FROM orders_rows_fields WHERE MATCH (rowStrValue) AGAINST (?)\n';
		sql += '  )\n';
		sql += ' )\n';
		dbFields.push('"' + this.q + '"');

		sql += ' )\n';

		return { sql, dbFields };
	}

	private concatSqlMatchAllFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (this.matchAllFields === undefined) {
			return { sql, dbFields };
		}

		for (const fieldName in this.matchAllFields) {
			dbFields.push(fieldName);

			sql += ' AND orders.uuid IN (\n';
			sql += '   SELECT DISTINCT orderUuid\n';
			sql += '   FROM orders_orders_fields\n';

			if (Array.isArray(this.matchAllFields[fieldName])) {
				sql += ' WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue IN (';
				for (const fieldValue of this.matchAllFields[fieldName]) {
					dbFields.push(fieldValue);
					sql += '?,';
				}
				sql = sql.substring(0, sql.length - 1);
				sql += ')\n';
			} else {
				dbFields.push(this.matchAllFields[fieldName] as string);
				sql += ' WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue = ?\n';
			}

			sql += ')';
		}

		return { sql, dbFields };
	}

	private concatSqlFieldNotEqualToFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (this.fieldNotEqualTo === undefined) {
			return { sql, dbFields };
		}

		for (const fieldName in this.fieldNotEqualTo) {
			sql += ' AND orders.uuid NOT IN (\n';
			sql += '   SELECT DISTINCT orderUuid\n';
			sql += '   FROM orders_orders_fields\n';
			sql += '   WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue = ?\n';
			sql += ')';

			dbFields.push(fieldName);
			dbFields.push(this.fieldNotEqualTo[fieldName]);
		}

		return { sql, dbFields };
	}

	private concatSqlFieldGreaterThanOrEqualToFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (this.fieldGreaterThanOrEqualTo === undefined) {
			return { sql, dbFields };
		}

		for (const fieldName in this.fieldGreaterThanOrEqualTo) {
			sql += ' AND orders.uuid IN (\n';
			sql += '   SELECT DISTINCT orderUuid\n';
			sql += '   FROM orders_orders_fields\n';
			sql += '   WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue >= ?\n';
			sql += ')';

			dbFields.push(fieldName);
			dbFields.push(this.fieldGreaterThanOrEqualTo[fieldName]);
		}

		return { sql, dbFields };
	}

	private concatSqlFieldLessThanOrEqualToFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (this.fieldLessThanOrEqualTo === undefined) {
			return { sql, dbFields };
		}

		for (const fieldName in this.fieldLessThanOrEqualTo) {
			sql += ' AND orders.uuid IN (\n';
			sql += '   SELECT DISTINCT orderUuid\n';
			sql += '   FROM orders_orders_fields\n';
			sql += '   WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue <= ?\n';
			sql += ')';

			dbFields.push(fieldName);
			dbFields.push(this.fieldLessThanOrEqualTo[fieldName]);
		}

		return { sql, dbFields };
	}

	private concatSqlFieldHasValue(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (!this.matchFieldHasValue || !this.matchFieldHasValue.length) return { sql, dbFields };

		for (const matchFieldHasValue of this.matchFieldHasValue) {
			sql += ' AND orders.uuid IN (\n';
			sql += '  SELECT orderUuid FROM orders_orders_fields WHERE fieldUuid IN (\n';
			sql += '   SELECT uuid FROM orders_orderFields WHERE\n';
			sql += '   name = ?\n';
			sql += '  )\n';
			sql += '  AND fieldValue IS NOT NULL AND fieldValue != ""\n';
			sql += ' )\n';

			dbFields.push(matchFieldHasValue);
		}

		return { sql, dbFields };
	}

	private concatSqlFieldHasNoValue(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (!this.matchFieldHasNoValue || !this.matchFieldHasNoValue.length) return { sql, dbFields };

		sql += ' AND (\n';
		sql += ' orders.uuid IN (\n';
		sql += '  SELECT orderUuid FROM orders_orders_fields WHERE fieldUuid IN (\n';
		sql += '   SELECT uuid FROM orders_orderFields WHERE\n';
		for (const matchFieldHasNoValue of this.matchFieldHasNoValue) {
			sql += 'name = ? OR ';
			dbFields.push(matchFieldHasNoValue);
		}
		sql = sql.substring(0, sql.length - 4);
		sql += '  )\n';
		sql += '  AND (fieldValue IS NULL OR fieldValue = "")\n';
		sql += ' )\n';
		sql += ' OR (\n';
		sql += '  orders.uuid NOT IN (\n';
		sql += '   SELECT orderUuid FROM orders_orders_fields WHERE fieldUuid IN (\n';
		sql += '    SELECT uuid FROM orders_orderFields WHERE\n';
		for (const matchFieldHasNoValue of this.matchFieldHasNoValue) {
			sql += 'name = ? OR ';
			dbFields.push(matchFieldHasNoValue);
		}
		sql = sql.substring(0, sql.length - 4);
		sql += '   )\n';
		sql += '  )\n';
		sql += ' )\n';
		sql += ')\n';

		return { sql, dbFields };
	}

	private concatSqlMatchAllRowsFieldsFilter(sql: string, dbFields: (string | number | Buffer)[]): ReturnType<typeof this.concatSqlUuidsFilter> {
		if (this.matchAllRowFields === undefined) {
			return { sql, dbFields };
		}

		for (const rowFieldName in this.matchAllRowFields) {
			sql += ' AND orders.uuid IN (\n';
			sql += '   SELECT DISTINCT orderUuid\n';
			sql += '   FROM orders_rows\n';
			sql += '   WHERE rowUuid IN (\n';
			sql += '     SELECT rowUuid FROM orders_rows_fields WHERE rowFieldUuid = (SELECT uuid FROM orders_rowFields WHERE name = ?) AND ';

			if (this.helpers.isNumberIsh(this.matchAllRowFields[rowFieldName])) {
				sql += 'rowIntValue = ?\n';
			} else {
				sql += 'rowStrValue = ?\n';
			}

			sql += '  )';
			sql += ')';

			dbFields.push(rowFieldName);
			dbFields.push(this.matchAllRowFields[rowFieldName]);
		}

		return { sql, dbFields };
	}

	private concatSqlLimitAndOffset(sql: string): string {
		if (this.limit) {
			sql += ` LIMIT ${Number(this.limit)}`;
			if (this.offset) {
				sql += ` OFFSET ${Number(this.offset)}`;
			}
		}

		return sql;
	}

	private async getAndPopulateOrderFields(orders: Record<string, OrderData>): Promise<void> {
		if (!this.returnFields || !Object.keys(orders).length) return;

		const dbFields = [];
		let sql;
		sql = 'SELECT orderUuid, name AS fieldName, fieldValue\n';
		sql += 'FROM orders_orders_fields JOIN orders_orderFields ON fieldUuid = uuid\n';
		sql += 'WHERE\n';
		sql += '  orderUuid IN (';

		for (const orderUuid in orders) {
			const buffer = this.helpers.uuidToBuffer(orderUuid);
			sql += '?,';
			dbFields.push(buffer);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';

		sql += ' AND name IN (';

		for (const returnField of this.returnFields) {
			sql += '?,';
			dbFields.push(returnField);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';

		const { rows: dbRows } = await this.db.query(sql, dbFields);
		for (const dbRow of dbRows) {
			const orderUuid = this.helpers.formatUuid(dbRow.orderUuid);
			const order = orders[orderUuid];

			if (!order) throw new Error(`Order field mismatch, got unexpected field for order uuid: "${orderUuid}", sql: ${sql}, dbFields: ${JSON.stringify(dbFields)}`);

			order.fields ??= {};
			order.fields[dbRow.fieldName] ??= [];
			(order.fields[dbRow.fieldName] as string[]).push(dbRow.fieldValue);
		}
	}

	private async getAndPopulateOrderRows(orders: Record<string, OrderData>): Promise<void> {
		const dbFields = [];

		if (!this.returnRowFields || !Object.keys(orders).length) return;

		let sql;
		sql = 'SELECT r.orderUuid, r.rowUuid, f.name AS fieldName, rf.rowIntValue, rf.rowStrValue\n';
		sql += 'FROM orders_rows r\n';
		sql += '  LEFT JOIN orders_rows_fields rf ON rf.rowUuid = r.rowUuid\n';
		sql += '  LEFT JOIN orders_rowFields f ON f.uuid = rf.rowFieldUuid\n';
		sql += 'WHERE r.orderUuid IN (';

		for (const orderUuid in orders) {
			const buffer = this.helpers.uuidToBuffer(orderUuid);
			sql += '?,';
			dbFields.push(buffer);
		}

		sql = sql.substring(0, sql.length - 1) + ')';
		sql += ' AND f.name IN (';

		for (const returnRowField of this.returnRowFields) {
			sql += '?,';
			dbFields.push(returnRowField);
		}

		sql = sql.substring(0, sql.length - 1) + ')';

		const { rows: dbRows } = await this.db.query(sql, dbFields);
		for (const dbRow of dbRows) {
			const orderUuid = this.helpers.formatUuid(dbRow.orderUuid);
			const rowUuid = this.helpers.formatUuid(dbRow.rowUuid);
			const order = orders[orderUuid];

			if (!order) throw new Error(`Order field mismatch, got unexpected rows for order uuid: "${orderUuid}", sql: ${sql}, dbFields: ${JSON.stringify(dbFields)}`);

			order.rows ??= [];

			let row = order.rows.find(r => r.uuid === rowUuid);
			if (!row) {
				row = {
					uuid: rowUuid,
				};

				order.rows.push(row);
			}

			row[dbRow.fieldName] ??= [];

			if (dbRow.rowIntValue !== null) {
				(row[dbRow.fieldName] as string[]).push(dbRow.rowIntValue);
			} else if (dbRow.rowStrValue !== null) {
				(row[dbRow.fieldName] as string[]).push(dbRow.rowStrValue);
			}
		}
	}
}
