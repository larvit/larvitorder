'use strict';

const uuidLib 	= require('node-uuid'),
      async			= require('async'),
      log 			= require('winston'),
      db    		= require('larvitdb');

function Orders() {
	this.filters = {};
}

Orders.prototype.get = function(cb) {
	const orderUuids = [],
	      tasks      = [],
	      that       = this;

	let orders = [];

	tasks.push(function(cb) {
		const dbFields = [];

		let sql = 'SELECT * FROM orders WHERE 1';

		if (that.filters.uuids !== undefined) {
			if (that.filters.uuids.length === 0) {
				sql += ' AND 0';
			} else {
				sql += ' AND uuid IN (';

				'use strict';

				const uuidLib 	= require('node-uuid'),
				      async			= require('async'),
				      log 			= require('winston'),
				      db    		= require('larvitdb');

				function Orders() {
					this.filters = {};
				}

				Orders.prototype.get = function(cb) {
					const orderUuids = [],
					      tasks      = [],
					      that       = this;

					let orders = [];

					tasks.push(function(cb) {
						const dbFields = [];

						let sql = 'SELECT * FROM orders WHERE 1';

						if (that.filters.uuids !== undefined) {
							if (that.filters.uuids.length === 0) {
								sql += ' AND 0';
							} else {
								sql += ' AND uuid IN (';

								for (let i = 0; that.filters.uuids[i] !== undefined; i ++) {
									let uuid = that.filters.uuids[i].replaceAll('-', '');
									sql += '?,';
									dbFields.push(new Buffer(uuid, 'hex'));
								}

								sql = sql.substring(0, sql.length - 1) + ')';
							}
						}

						sql += ' ORDER BY created';

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

					async.series(tasks, function(err, result) {
						cb(null, orders);
					});

				};

				exports = module.exports = Orders;
				for (let i = 0; that.filters.uuids[i] !== undefined; i ++) {
					let uuid = that.filters.uuids[i].replaceAll('-', '');
					sql += '?,';
					dbFields.push(new Buffer(uuid, 'hex'));
				}

				sql = sql.substring(0, sql.length - 1) + ')';
			}
		}

		sql += ' ORDER BY created';

		log.debug('larvitorder: orders.get() - Getting orders');
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
