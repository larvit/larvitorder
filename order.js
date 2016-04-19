'use strict';

const uuidLib = require('node-uuid'),
      async   = require('async'),
      log     = require('winston'),
      db      = require('larvitdb');

String.prototype.replaceAll = function(search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

class Order {

	constructor(options) {
		if (options === undefined) {
			options = {};
		}

		this.orderData = {};

		// If options is a string, assume it is an uuid
		if (typeof options === 'string') {
			this.uuid = options;
			options   = {};
		} else {
			this.uuid = uuidLib.v4();
		}

		log.verbose('larvitorder: New Order - Creating Order with uuid: ' + this.uuid);

		this.created = new Date();
		this.fields  = options.fields;
		this.rows    = options.rows;

		if (this.rows === undefined) {
			this.rows = [];
		}

		for (let i = 0; this.rows[i] !== undefined; i ++) {
			if (this.rows[i].uuid === undefined) {
				this.rows[i].uuid = uuidLib.v4();
			}
		}
	}

	loadFromDb(cb) {
		const tasks = [],
		      that 	= this;

		// Get basic order data
		tasks.push(function(cb) {
			log.debug('larvitorder: getOrder() - Getting order: ' + that.uuid);
			db.query('SELECT * FROM orders WHERE uuid = ?', [new Buffer(uuidLib.parse(that.uuid))], function(err, rows) {
				if (err) {
					cb(err);
					return;
				}

				if (rows.length) {
					that.uuid    = uuidLib.unparse(rows[0].uuid);
					that.created = rows[0].created;
				}
				cb();
			});
		});

		// Get fields
		tasks.push(function(cb) {
			that.getOrderFields(function(err, fields) {
				that.fields = fields;
				cb();
			});
		});

		// Get rows
		tasks.push(function(cb) {
			that.getOrderRows(function(err, rows) {
				that.rows = rows;
				cb();
			});
		});

		async.series(tasks, cb);
	}

	getOrderFields(cb) {
		const fields = {},
		      that   = this;

		let sql = '';
		sql += 'SELECT orders_orderFields.name AS name, orders_orders_fields.fieldValue AS value\n';
		sql += 'FROM orders_orders_fields\n';
		sql += '	INNER JOIN orders_orderFields\n';
		sql += '		ON orders_orders_fields.fieldId = orders_orderFields.id\n';
		sql += 'WHERE orders_orders_fields.orderUuid = ?';

		db.query(sql, [new Buffer(uuidLib.parse(that.uuid))], function(err, data) {
			if (err) {
				cb(err);
				return;
			}

			for (let i = 0; data.length > i; i ++) {
				fields[data[i].name] = data[i].value;
			}

			cb(null, fields);
		});
	}

	getOrderRows(cb) {
		const sorter = [],
		      rows   = [],
		      that   = this;

		let sql = '';

		sql += 'SELECT orders_rows.rowUuid, orders_rows_fields.rowStrValue, orders_rows_fields.rowIntValue, orders_rowFields.name\n';
		sql += 'FROM orders_rows\n';
		sql += '	INNER JOIN orders_rows_fields\n';
		sql += '		ON orders_rows_fields.rowUuid = orders_rows.rowUuid\n';
		sql += '	INNER JOIN orders_rowFields\n';
		sql += '		ON orders_rowFields.id = orders_rows_fields.rowFieldUuid\n';
		sql += 'WHERE orders_rows.orderUuid = ?';

		db.query(sql, [new Buffer(uuidLib.parse(that.uuid))], function(err, data) {
			if (err) {
				cb(err);
				return;
			}

			for (let i = 0; data.length > i; i ++) {
				data[i].rowUuid = uuidLib.unparse(data[i].rowUuid);

				if (sorter[data[i].rowUuid] === undefined) {
					sorter[data[i].rowUuid] = {
						'rowUuid': data[i].rowUuid
					};
				}

				sorter[data[i].rowUuid][data[i].name] = data[i].rowStrValue;
			}

			for (let key in sorter) {
				rows.push(sorter[key]);
			}

			cb(null, rows);
		});
	}

	// Creates order fields if not already exists in the "orders_orderFields" table.
	createOrderField(fieldName, fieldValue, cb) {
		const that = this;

		log.debug('larvitorder: createOrderField() - Creating order field: ' + fieldName);
		db.query('INSERT IGNORE INTO orders_orderFields (name) VALUE(?)', [fieldName], function(err) {
			if (err) {
				cb(err);
				return;
			}

			that.insertOrderfieldValue(fieldName, fieldValue, cb);
		});
	}

	// Inserts order field values to the "orders_orders_fields" table.
	insertOrderfieldValue(fieldName, fieldValue, cb) {
		const that = this;

		db.query('SELECT * FROM orders_orderFields WHERE name = ?', [fieldName], function(err, result) {
			if (err) {
				cb(err);
				return;
			}

			log.debug('larvitorder: insertOrderfieldValue() - Writing order field value: ' + fieldName + ' => ' + fieldValue);
			db.query('INSERT INTO orders_orders_fields (orderUuid, fieldId, fieldValue) VALUE(?, ?, ?)', [that.uuid, result[0].id, fieldValue], cb);
		});
	}

	// Creates the order i the "orders" table.
	insertOrder(cb) {
		const that = this;

		log.debug('larvitorder: insertOrder() - Writing order: ' + that.uuid);
		db.query('INSERT IGNORE INTO orders (uuid, created) VALUE(?, ?)', [that.uuid, that.created], cb);
	}

	// Creates a row i the "orders_rows" table.
	insertRow(row, cb) {
		const that = this;

		if ( ! row.uuid) {
			row.uuid = uuidLib.v4();
		}

		log.debug('larvitorder: insertRow() - Writing row: ' + row.uuid);
		db.query('INSERT INTO orders_rows (rowUuid, orderUuid) VALUE(?, ?)', [row.uuid, that.uuid], cb);
	}

	// Creates order fields if not already exists in the "orders_orderFields" table.
	createRowField(fieldName, fieldValue, cb) {
		log.debug('larvitorder: createRowField() - Creating row field: ' + fieldName);
		db.query('INSERT IGNORE INTO orders_rowFields (name) VALUE(?)', [fieldName], cb);
	}

	/**
	 * Inserts order field values to the "orders_orders_fields" table.
	 *
	 * @param str rowUuid
	 * @param str fieldName
	 * @param str or int fieldValue
	 * @param func cb(err, res) - res is from the db query
	 */
	insertRowfieldValue(rowUuid, fieldName, fieldValue, cb) {
		let rowIntValue,
		    rowStrValue;

		if (fieldValue === parseInt(fieldValue)) {
			rowIntValue = fieldValue;
			rowStrValue = null;
		} else {
			rowIntValue = null;
			rowStrValue = fieldValue;
		}

		db.query('SELECT * FROM orders_rowFields WHERE name = ?', [fieldName], function(err, field) {
			const dbFields = [rowUuid, field[0].id, rowIntValue, rowStrValue],
			      sql      = 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUE(?, ?, ?, ?)';

			log.debug('larvitorder: insertRowfieldValue() - Writing row field value: ' + fieldName + ' => ' + fieldValue);
			db.query(sql, dbFields, cb);
		});
	}

	// Saving the order object to the database.
	save(cb) {
		const tasks = [],
		      that  = this;

		// Insert order
		tasks.push(function(cb) {
			that.insertOrder(cb);
		});

		// Replace order fields and fieldValues
		tasks.push(function(cb) {
			const subTasks = [];

			let createSubtask;

			createSubtask = function(key, value) {
				subTasks.push(function(cb) {
					that.createOrderField(key, value, cb);
				});
			};

			for (let key in that.fields) {
				createSubtask(key, that.fields[key]);
			}

			async.series(subTasks, function(err, result) {
				cb(null, result);
			});
		});

		// Insert rows
		tasks.push(function(cb) {
			that.insertRow(that.rows[0], function(result) {
				cb(null, result);
			});
		});

		// Insert order fields and fieldValues
		tasks.push(function(cb) {
			const subTasks = [];

			function createFields(fieldName, fieldValue) {
				subTasks.push(function(cb) {
					that.createRowField(fieldName, fieldValue, function(result) {
						cb(null, result);
					});
				});
			};

			function insertfieldValues(rowUuid, fieldName, fieldValue) {
				subTasks.push(function(cb) {
					that.insertRowfieldValue(rowUuid, fieldName, fieldValue, function(err, result) {
						cb(null, result);
					});
				});
			};

			for (let i = 0; that.rows[i] !== undefined; i ++) {
				for (let key in that.rows[i]) {
					if (key !== 'uuid') {
						createFields(key, that.rows[i][key]);
						insertfieldValues(that.rows[i].uuid, key, that.rows[i][key]);
					}
				}
			}

			async.series(subTasks, function(err, result) {
				cb(null, result);
			});
		});

		async.series(tasks, function(err, result) {
			cb(null, result);
		});

	}
}

exports = module.exports = Order;
