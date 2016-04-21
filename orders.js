'use strict';

const uuidLib = require('node-uuid'),
      ready   = require(__dirname + '/migrate.js').ready,
      async   = require('async'),
      db      = require('larvitdb');

function Orders() {
}

Orders.prototype.get = function(cb) {
	const tasks = [],
	      that  = this;

	let orders = {};

	// Get basic orders
	tasks.push(function(cb) {
		const dbFields = [];

		let sql = 'SELECT * FROM orders WHERE 1';
		if (that.uuids !== undefined) {
			if ( ! (that.uuids instanceof Array)) {
				that.uuids = [that.uuids];
			}

			if (that.uuids.length === 0) {
				sql += ' AND 0';
			} else {
				sql += ' AND uuid IN (';

				for (let i = 0; that.uuids[i] !== undefined; i ++) {
					let uuid = that.uuids[i].replaceAll('-', '');
					sql += '?,';
					dbFields.push(new Buffer(uuid, 'hex'));
				}

				sql = sql.substring(0, sql.length - 1) + ')';
			}
		}

		sql += ' ORDER BY created';

		if (that.limit) {
			sql += ' LIMIT ' + parseInt(that.limit);
			if (that.offset) {
				sql += ' OFFSET ' + parseInt(that.offset);
			}
		}

		ready(function() {
			db.query(sql, dbFields, function(err, rows) {
				if (err) {
					cb(err);
					return;
				}

				for (let i = 0; rows[i] !== undefined; i ++) {
					rows[i].uuid                 = uuidLib.unparse(rows[i].uuid);
					orders[rows[i].uuid]         = {};
					orders[rows[i].uuid].uuid    = rows[i].uuid;
					orders[rows[i].uuid].created = rows[i].created;
				}

				cb();
			});
		});
	});

	// Get fields
	tasks.push(function(cb) {
		const dbFields = [];

		let sql;

		if ( ! that.returnFields) {
			cb();
			return;
		}

		sql =  'SELECT orderUuid, name AS fieldName, fieldValue\n';
		sql += 'FROM orders_orders_fields JOIN orders_orderFields ON fieldId = id\n';
		sql += 'WHERE\n';
		sql += '	orderUuid IN (';

		for (let orderUuid in orders) {
			sql += '?,';
			dbFields.push(new Buffer(uuidLib.parse(orderUuid)));
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';

		sql += '	AND name IN (';

		for (let i = 0; that.returnFields[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(that.returnFields[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';
		ready(function() {
			db.query(sql, dbFields, function(err, rows) {
				if (err) {
					cb(err);
					return;
				}

				for (let i = 0; rows[i] !== undefined; i ++) {
					const row = rows[i];

					row.orderUuid = uuidLib.unparse(row.orderUuid);

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
	});

	// Get rows
	tasks.push(function(cb) {
		const dbFields = [];

		let sql;

		if (that.returnRowFields === undefined) {
			cb();
			return;
		}

		sql  = 'SELECT r.orderUuid, r.rowUuid, f.name AS fieldName, rf.rowIntValue, rf.rowStrValue\n';
		sql += 'FROM orders_rows r\n';
		sql += '	LEFT JOIN orders_rows_fields rf ON rf.rowUuid = r.rowUuid\n';
		sql += '	LEFT JOIN orders_rowFields f ON f.id = rf.rowFieldId\n';
		sql += 'WHERE r.orderUuid IN (';

		for (let orderUuid in orders) {
			sql += '?,';
			dbFields.push(new Buffer(uuidLib.parse(orderUuid)));
		}

		sql = sql.substring(0, sql.length - 1) + ')';
		sql += ' AND f.name IN (';

		for (let i = 0; that.returnRowFields[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(that.returnRowFields[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')';

		ready(function() {
			db.query(sql, dbFields, function(err, rows) {
				if (err) {
					cb(err);
					return;
				}

				for (let i = 0; rows[i] !== undefined; i ++) {
					const row = rows[i];

					row.orderUuid = uuidLib.unparse(row.orderUuid);
					row.rowUuid   = uuidLib.unparse(row.rowUuid);

					if (orders[row.orderUuid].rows === undefined) {
						orders[row.orderUuid].rows = {};
					}

					if (orders[row.orderUuid].rows[row.rowUuid] === undefined) {
						orders[row.orderUuid].rows[row.rowUuid] = {'uuid': row.rowUuid};
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
	});

	async.series(tasks, function(err) {
		if (err) {
			cb(err);
			return;
		}

		//console.log(require('util').inspect(orders, {showHidden: false, depth: null}));
		cb(null, orders);
	});

};

exports = module.exports = Orders;
