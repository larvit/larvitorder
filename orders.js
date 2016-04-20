'use strict';

const uuidLib = require('node-uuid'),
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

	async.series(tasks, function(err) {
		if (err) {
			cb(err);
			return;
		}

		cb(null, orders);
	});

};

exports = module.exports = Orders;
