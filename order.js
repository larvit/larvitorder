'use strict';

const uuidLib	= require('node-uuid'),
      async		= require('async'),
      log 		= require('winston'),
      db    	= require('larvitdb');


String.prototype.replaceAll = function(search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

class Order {

	constructor(options, cb) {
		if (typeof(options) === 'string') {
			this.uuid = options;

			this.getOrder(function(err, order) {
				if (err) {
					cb(err);
					return;
				}

				cb(null, order);
			});

		} else {
			let i = 0;

			this.created	= new Date();
			this.uuid			= uuidLib.v4();
			this.rows			= options.rows;
			this.fields		= options.fields;

			log.verbose('larvitorder: New Order - Creating Order with uuid: ' + this.uuid);
			while (this.rows[i] !== undefined) {
				this.rows[i].uuid = uuidLib.v4();
				i ++;
			}
		}
	}

	getOrder(cb) {
		const tasks = [],
		      that 	= this;

		let order = {};

		tasks.push(function(cb) {
			const order = {};

			log.debug('larvitorder: getOrder() - Getting order: ' + that.uuid);
			db.query('SELECT * FROM orders WHERE HEX(uuid) = ?', [that.uuid.replaceAll('-', '')], function(err, data) {
				if (err) {
					cb(err);
					return;
				}

				order.uuid = uuidLib.unparse(data[0].uuid);
				order.created = data[0].created;
				cb(null, order);
			});
		});

		tasks.push(function(cb) {
			that.getOrderFields(function(err, fields) {
				cb(null, fields);
			});
		});

		tasks.push(function(cb) {
			that.getOrderRows(function(err, rows) {
				cb(null, rows)
			});
		});

		async.series(tasks, function(err, result) {
			if (err) {
				cb(err);
				return;
			}

			order = result[0];
			order.fields = result[1];
			order.rows = result[2];

			cb(null, order);
		});
	}


	getOrderFields(cb) {
		const fields 	= {},
		      that 		= this;

		let sql = '';
		sql += 'SELECT orders_orderFields.name as name, orders_orders_fields.fieldValue as value';
		sql += ' FROM orders_orders_fields';
		sql += ' INNER JOIN orders_orderFields';
		sql += ' ON orders_orders_fields.fieldId=orders_orderFields.id';
		sql += ' WHERE HEX(orders_orders_fields.orderUuid) = ?';

		db.query(sql, [that.uuid.replaceAll('-', '')], function(err, data) {
			if (err) {
				cb(err);
				return;
			}

			for(let i = 0; data.length > i; i ++) {
				fields[data[i].name] = data[i].value;
			}

			cb(null, fields);
		});
	}

	getOrderRows(cb) {
		const sorter 	= [],
					rows 		= [],
					that 		= this;

		let sql    = '';

		sql += 'SELECT orders_rows.rowUuid, orders_rows_fields.rowStrValue, orders_rows_fields.rowIntValue, orders_rowFields.name';
		sql += ' FROM orders_rows';
		sql += ' INNER JOIN orders_rows_fields';
		sql += ' ON orders_rows_fields.rowUuid=orders_rows.rowUuid';
		sql += ' INNER JOIN orders_rowFields';
		sql += ' ON orders_rowFields.id=orders_rows_fields.rowFieldUuid';
		sql += ' WHERE HEX(orders_rows.orderUuid) = ?';


		db.query(sql, [that.uuid.replaceAll('-', '')], function(err, data) {
			if (err) {
				cb(err);
				return;
			}

			for (let i = 0; data.length > i; i ++) {

				if (sorter[uuidLib.unparse(data[i].rowUuid)] === undefined)
				 sorter[uuidLib.unparse(data[i].rowUuid)] = {
					 rowUuid: uuidLib.unparse(data[i].rowUuid)
				 };

				sorter[uuidLib.unparse(data[i].rowUuid)][data[i].name] = data[i].rowStrValue;
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

		if ( ! row.uuid)
			row.uuid = uuidLib.v4();

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

		let i	= 0;

		// Insert order
		tasks.push(function(cb) {
			that.insertOrder(cb);
		});

		// Replace order fields and fieldValues
		tasks.push(function(cb) {
			const subtasks = [];

			let createSubtask;

			createSubtask = function(key, value) {
				subtasks.push(function(cb) {
					that.createOrderField(key, value, cb);
				});
			};

			for (let key in that.fields) {
				createSubtask(key, that.fields[key]);
			}

			async.series(subtasks, function(err, result) {
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
			var subtasks = new Array(),
			createFields,
			insertfieldValues;

			createFields = function(fieldName, fieldValue) {
				subtasks.push(function(cb) {
					that.createRowField(fieldName, fieldValue, function(result) {
						cb(null, result);
					});
				});
			};

			insertfieldValues = function(rowUuid, fieldName, fieldValue) {
				subtasks.push(function(cb) {
					that.insertRowfieldValue(rowUuid, fieldName, fieldValue, function(err, result) {
						cb(null, result);
					});
				});
			};

			while (that.rows.length > i) {
				for (let key in that.rows[i]) {
					if (key !== 'uuid') {
						createFields(key, that.rows[i][key]);
						insertfieldValues(that.rows[i].uuid, key, that.rows[i][key]);
					}
				}
				i ++;
			}

			async.series(subtasks, function(err, result) {
				cb(null, result);
			});
		});

		async.series(tasks, function(err, result) {
			cb(null, result);
		});

	}
}

exports = module.exports = Order;
