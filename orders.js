/* eslint-disable no-tabs */
'use strict';

const LUtils = require('larvitutils');
const async = require('async');

function Orders(options) {
	this.options = options || {};

	if (!options.db) throw new Error('Missing required option "db"');

	if (!options.log) {
		const tmpLUtils = new LUtils();

		options.log = new tmpLUtils.lUtils.Log();
	}

	if (!options.lUtils) options.lUtils = new LUtils();

	this.options = options;

	for (const key of Object.keys(options)) {
		this[key] = options[key];
	}
}

Orders.prototype.get = function (cb) {
	const tasks = [];
	let orders = {};

	let hits;

	// Get basic orders
	tasks.push(cb => {
		const dbFields = [];

		let sql = ' FROM orders WHERE 1';
		let hitsSql = '';

		if (this.uuids !== undefined) {
			if (!(this.uuids instanceof Array)) {
				this.uuids = [this.uuids];
			}

			if (this.uuids.length === 0) {
				sql += '	AND 0';
			} else {
				sql += '	AND uuid IN (';

				for (let i = 0; this.uuids[i] !== undefined; i++) {
					const buffer = this.lUtils.uuidToBuffer(this.uuids[i]);

					if (buffer === false) {
						return cb(new Error('Invalid order uuid supplied'));
					}

					sql += '?,';
					dbFields.push(buffer);
				}

				sql = sql.substring(0, sql.length - 1) + ')';
			}
		}

		if (this.q !== undefined) {
			sql += ' AND (\n';
			sql += '		(\n';
			sql += '   			uuid IN (SELECT DISTINCT orderUuid FROM orders_orders_fields WHERE fieldValue LIKE ?)\n';
			sql += '		)\n';
			dbFields.push('%' + this.q + '%');

			sql += ' 	OR uuid IN (\n';
			sql += '		SELECT DISTINCT orderUuid\n';
			sql += '		FROM orders_rows WHERE rowUuid IN (\n';
			sql += '			SELECT rowUuid FROM orders_rows_fields WHERE rowStrValue LIKE ?\n';
			sql += '		)\n';
			sql += '	)\n';
			sql += ' )\n';
			dbFields.push('%' + this.q + '%');
		}

		if (this.matchAllFields !== undefined) {
			for (let fieldName in this.matchAllFields) {
				sql += '	AND orders.uuid IN (\n';
				sql += '		SELECT DISTINCT orderUuid\n';
				sql += '		FROM orders_orders_fields\n';
				sql += '		WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue = ?\n';
				sql += ')';

				dbFields.push(fieldName);
				dbFields.push(this.matchAllFields[fieldName]);
			}
		}

		if (this.fieldNotEqualTo !== undefined) {
			for (let fieldName in this.fieldNotEqualTo) {
				sql += '	AND orders.uuid NOT IN (\n';
				sql += '		SELECT DISTINCT orderUuid\n';
				sql += '		FROM orders_orders_fields\n';
				sql += '		WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue = ?\n';
				sql += ')';

				dbFields.push(fieldName);
				dbFields.push(this.fieldNotEqualTo[fieldName]);
			}
		}

		if (this.fieldGreaterThanOrEqualTo !== undefined) {
			for (let fieldName in this.fieldGreaterThanOrEqualTo) {
				sql += '	AND orders.uuid IN (\n';
				sql += '		SELECT DISTINCT orderUuid\n';
				sql += '		FROM orders_orders_fields\n';
				sql += '		WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue >= ?\n';
				sql += ')';

				dbFields.push(fieldName);
				dbFields.push(this.fieldGreaterThanOrEqualTo[fieldName]);
			}
		}

		if (this.matchAllRowFields !== undefined) {
			for (let rowFieldName in this.matchAllRowFields) {
				sql += '	AND orders.uuid IN (\n';
				sql += '		SELECT DISTINCT orderUuid\n';
				sql += '		FROM orders_rows\n';
				sql += '		WHERE rowUuid IN (\n';
				sql += '			SELECT rowUuid FROM orders_rows_fields WHERE rowFieldUuid = (SELECT uuid FROM orders_rowFields WHERE name = ?) AND ';

				if (parseInt(this.matchAllRowFields[rowFieldName]) === this.matchAllRowFields[rowFieldName]) {
					sql += 'rowIntValue = ?\n';
				} else {
					sql += 'rowStrValue = ?\n';
				}

				sql += '		)';
				sql += '	)';

				dbFields.push(rowFieldName);
				dbFields.push(this.matchAllRowFields[rowFieldName]);
			}
		}

		sql += '	ORDER BY created DESC';

		hitsSql = 'SELECT COUNT(*) AS hits' + sql;
		sql = 'SELECT *' + sql;

		if (this.limit) {
			sql += ' LIMIT ' + parseInt(this.limit);
			if (this.offset) {
				sql += ' OFFSET ' + parseInt(this.offset);
			}
		}

		const tasks = [];

		tasks.push(cb => {
			this.db.query(sql, dbFields, (err, rows) => {
				if (err) return cb(err);

				for (let i = 0; rows[i] !== undefined; i++) {
					rows[i].uuid = this.lUtils.formatUuid(rows[i].uuid);
					orders[rows[i].uuid] = {};
					orders[rows[i].uuid].uuid = rows[i].uuid;
					orders[rows[i].uuid].created = rows[i].created;
				}

				cb();
			});
		});

		tasks.push(cb => {
			this.db.query(hitsSql, dbFields, (err, rows) => {
				if (err) return cb(err);

				hits = rows[0].hits;

				cb();
			});
		});

		async.parallel(tasks, cb);
	});

	// Get fields
	tasks.push(cb => {
		const dbFields = [];

		let sql;

		if (!this.returnFields || Object.keys(orders).length === 0) return cb();

		sql = 'SELECT orderUuid, name AS fieldName, fieldValue\n';
		sql += 'FROM orders_orders_fields JOIN orders_orderFields ON fieldUuid = uuid\n';
		sql += 'WHERE\n';
		sql += '	orderUuid IN (';

		for (let orderUuid in orders) {
			const buffer = this.lUtils.uuidToBuffer(orderUuid);

			if (buffer === false) {
				return cb(new Error('Invalid order uuid supplied'));
			}

			sql += '?,';
			dbFields.push(buffer);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';

		sql += '	AND name IN (';

		for (let i = 0; this.returnFields[i] !== undefined; i++) {
			sql += '?,';
			dbFields.push(this.returnFields[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';

		this.db.query(sql, dbFields, (err, rows) => {
			if (err) return cb(err);

			for (let i = 0; rows[i] !== undefined; i++) {
				const row = rows[i];

				row.orderUuid = this.lUtils.formatUuid(row.orderUuid);

				if (orders[row.orderUuid].fields === undefined) {
					orders[row.orderUuid].fields = {};
				}

				if (orders[row.orderUuid].fields[row.fieldName] === undefined) {
					orders[row.orderUuid].fields[row.fieldName] = [];
				}

				orders[row.orderUuid].fields[row.fieldName].push(row.fieldValue);
			}

			cb();
		});
	});

	// Get rows
	tasks.push(cb => {
		const dbFields = [];

		let sql;

		if (this.returnRowFields === undefined || Object.keys(orders).length === 0) return cb();

		sql = 'SELECT r.orderUuid, r.rowUuid, f.name AS fieldName, rf.rowIntValue, rf.rowStrValue\n';
		sql += 'FROM orders_rows r\n';
		sql += '	LEFT JOIN orders_rows_fields	rf	ON rf.rowUuid = r.rowUuid\n';
		sql += '	LEFT JOIN orders_rowFields	f	ON f.uuid = rf.rowFieldUuid\n';
		sql += 'WHERE r.orderUuid IN (';

		for (let orderUuid in orders) {
			const buffer = this.lUtils.uuidToBuffer(orderUuid);

			if (buffer === false) {
				return cb(new Error('Invalid order uuid supplied'));
			}

			sql += '?,';
			dbFields.push(buffer);
		}

		sql = sql.substring(0, sql.length - 1) + ')';
		sql += '	AND f.name IN (';

		for (let i = 0; this.returnRowFields[i] !== undefined; i++) {
			sql += '?,';
			dbFields.push(this.returnRowFields[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')';

		this.db.query(sql, dbFields, (err, rows) => {
			if (err) return cb(err);

			for (let i = 0; rows[i] !== undefined; i++) {
				const row = rows[i];

				row.orderUuid = this.lUtils.formatUuid(row.orderUuid);
				row.rowUuid = this.lUtils.formatUuid(row.rowUuid);

				if (orders[row.orderUuid].rows === undefined) {
					orders[row.orderUuid].rows = {};
				}

				if (orders[row.orderUuid].rows[row.rowUuid] === undefined) {
					orders[row.orderUuid].rows[row.rowUuid] = {uuid: row.rowUuid};
				}

				if (orders[row.orderUuid].rows[row.rowUuid][row.fieldName] === undefined) {
					orders[row.orderUuid].rows[row.rowUuid][row.fieldName] = [];
				}

				if (row.rowIntValue !== null) {
					orders[row.orderUuid].rows[row.rowUuid][row.fieldName].push(row.rowIntValue);
				} else if (row.rowStrValue !== null) {
					orders[row.orderUuid].rows[row.rowUuid][row.fieldName].push(row.rowStrValue);
				}
			}

			cb();
		});
	});

	async.series(tasks, function (err) {
		if (err) return cb(err);

		cb(null, orders, hits);
	});
};

exports = module.exports = Orders;
