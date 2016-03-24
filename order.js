'use strict';

const async = require('async'),
      uuid  = require('node-uuid'),
      log   = require('winston'),
      db    = require('larvitdb');

class Order {

	constructor(rows) {
		let i = 0;

		this.created = new Date();
		this.uuid    = uuid.v4();
		this.rows    = rows;

		log.verbose('larvitorder: New Order - Creating Order with uuid: ' + this.uuid);
		while (this.rows[i] !== undefined) {
			this.rows[i].set('uuid', uuid.v4());
			i ++;
		}
	}

	// Adds order field to the order object.
	addOrderField(key, value) {
		this[key] = value;
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

		if ( ! row.get('uuid'))
			row.set('uuid', uuid.v4());

		log.debug('larvitorder: insertRow() - Writing row: ' + row.get('uuid'));
		db.query('INSERT INTO orders_rows (rowUuid, orderUuid) VALUE(?, ?)', [row.get('uuid'), that.uuid], cb);
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
			      sql      = 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUE(?, ?, ?, ?)',

			log.debug('larvitorder: insertRowfieldValue() - Writing row field value: ' + fieldName + ' => ' + fieldValue);
			db.query(sql, dbFields, cb);
		});
	}

	// Saving the order object to the database.
	save(cb) {
		const tasks = [],
		      that  = this;

		// Insert order
		tasks.push(that.insertOrder);

		// Replace order fields and fieldValues
		tasks.push(function(cb) {
			const subtasks = [];

			let createSubtask;

			createSubtask = function(key, value) {
				subtasks.push(function(cb) {
					order.createOrderField(key, value, cb);
				});
			};

			for (let key in that.fields) {
				let keyVal = that.fields[key];

				if (
					   key !== 'uuid'
					&& key !== 'rows'
					&& key !== 'created'
					&& that.hasOwnProperty(key)
					) {
					createSubtask(key, that[key]);
			}
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

			that.rows.forEach(function (row) {
				row.forEach(function(fieldValue, fieldName) {
					createFields(fieldName, fieldValue);
					insertfieldValues(row.get('uuid'), fieldName, fieldValue);
				});
			});

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