'use strict';

const uuidLib = require('node-uuid'),
      ready   = require(__dirname + '/migrate.js').ready,
      async   = require('async'),
      db      = require('larvitdb');

function Orders() {
}

Orders.prototype.get = function(cb) {
	const orderUuids = [],
	      tasks      = [],
	      that       = this;

	let orders = [];

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

				orders = rows;

				for (let i = 0; orders[i] !== undefined; i ++) {
					orders[i].uuid = uuidLib.unparse(orders[i].uuid);
					orderUuids.push(orders[i].uuid);
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

		for (let i = 0; orderUuids[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(new Buffer(uuidLib.parse(orderUuids[i])));
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
				const rowsByOrderUuid = {};

				if (err) {
					cb(err);
					return;
				}

				for (let i = 0; rows[i] !== undefined; i ++) {
					const row = rows[i];

					row.orderUuid = uuidLib.unparse(row.orderUuid);

					if (rowsByOrderUuid[row.orderUuid] === undefined) {
						rowsByOrderUuid[row.orderUuid] = [];
					}

					rowsByOrderUuid[row.orderUuid].push(row);
				}

				for (let i = 0; orders[i] !== undefined; i ++) {
					const order = orders[i];

					order.fields = {};

					for (let i = 0; rowsByOrderUuid[order.uuid][i] !== undefined; i ++) {
						const row = rowsByOrderUuid[order.uuid][i];

						if (order.fields[row.fieldName] === undefined) {
							order.fields[row.fieldName] = [];
						}

						order.fields[row.fieldName].push(row.fieldValue);
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

		cb(null, orders);
	});

};

exports = module.exports = Orders;
