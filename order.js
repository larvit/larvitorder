'use strict';

const	dbmigration	= require('larvitdbmigration')({'tableName': 'orders_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	orderFields	= [],
	uuidLib	= require('node-uuid'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

let	readyInProgress	= false,
	isReady	= false;

function ready(cb) {
	const	tasks	= [];

	if (isReady === true) { cb(); return; }

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	readyInProgress = true;

	// Migrate database
	tasks.push(function(cb) {
		dbmigration(function(err) {
			if (err) {
				log.error('larvitorder: orders.js: Database error: ' + err.message);
				return;
			}

			cb();
		});
	});

	// Load order fields
	tasks.push(loadOrderFieldsToCache);

	async.series(tasks, function() {
		isReady	= true;
		eventEmitter.emit('ready');
		cb();
	});
}

function loadOrderFieldsToCache(cb) {
	db.query('SELECT * FROM orders_orderFields ORDER BY id;', function(err, rows) {
		if (err) {
			log.error('larvitorder: orders.js: Database error: ' + err.message);
			return;
		}

		// Empty the previous cache
		orderFields.length = 0;

		// Load the new values
		for (let i = 0; rows[i] !== undefined; i ++) {
			orderFields.push(rows[i]);
		}

		cb();
	});
}

function Order(options) {
	if (options === undefined) {
		options = {};
	}

	// If options is a string, assume it is an uuid
	if (typeof options === 'string') {
		this.uuid	= options;
		options	= {};
	} else {
		this.uuid	= uuidLib.v4();
	}

	log.verbose('larvitorder: New Order - Creating Order with uuid: ' + this.uuid);

	this.created	= new Date();
	this.fields	= options.fields;
	this.rows	= options.rows;

	if (this.fields = undefined) {
		this.fields = [];
	}

	if (this.rows === undefined) {
		this.rows = [];
	}

	for (let i = 0; this.rows[i] !== undefined; i ++) {
		if (this.rows[i].uuid === undefined) {
			this.rows[i].uuid = uuidLib.v4();
		}
	}
}

Order.prototype.loadFromDb = function(cb) {
	const	tasks	= [],
		that	= this;

	tasks.push(ready);

	// Get basic order data
	tasks.push(function(cb) {
		log.debug('larvitorder: getOrder() - Getting order: ' + that.uuid);
		db.query('SELECT * FROM orders WHERE uuid = ?', [new Buffer(uuidLib.parse(that.uuid))], function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length) {
				that.uuid	= uuidLib.unparse(rows[0].uuid);
				that.created	= rows[0].created;
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
};

Order.prototype.getOrderFields = function(cb) {
	const	fields	= {},
		that	= this;

	let sql = '';
	sql += 'SELECT orders_orderFields.name AS name, orders_orders_fields.fieldValue AS value\n';
	sql += 'FROM orders_orders_fields\n';
	sql += '	INNER JOIN orders_orderFields\n';
	sql += '		ON orders_orders_fields.fieldId = orders_orderFields.id\n';
	sql += 'WHERE orders_orders_fields.orderUuid = ?';

	ready(function() {
		db.query(sql, [new Buffer(uuidLib.parse(that.uuid))], function(err, data) {
			if (err) { cb(err); return; }

			for (let i = 0; data.length > i; i ++) {
				if (fields[data[i].name] !== undefined) {
					fields[data[i].name].push(data[i].value);
				} else {
					fields[data[i].name] = [data[i].value];
				}
			}
			cb(null, fields);
		});
	});
};

Order.prototype.getOrderRows = function(cb) {
	const	sorter	= [],
		rows	= [],
		that	= this;

	let sql = '';

	sql += 'SELECT orders_rows.rowUuid, orders_rows_fields.rowStrValue, orders_rows_fields.rowIntValue, orders_rowFields.name\n';
	sql += 'FROM orders_rows\n';
	sql += '	INNER JOIN orders_rows_fields\n';
	sql += '		ON orders_rows_fields.rowUuid = orders_rows.rowUuid\n';
	sql += '	INNER JOIN orders_rowFields\n';
	sql += '		ON orders_rowFields.id = orders_rows_fields.rowFieldId\n';
	sql += 'WHERE orders_rows.orderUuid = ?';

	ready(function() {
		db.query(sql, [new Buffer(uuidLib.parse(that.uuid))], function(err, data) {
			if (err) { cb(err); return; }

			for (let i = 0; data.length > i; i ++) {
				let value;

				data[i].rowUuid = uuidLib.unparse(data[i].rowUuid);

				if (sorter[data[i].rowUuid] === undefined) {
					sorter[data[i].rowUuid] = {
						'rowUuid': data[i].rowUuid
					};
				}

				if (data[i].rowStrValue === null) {
					value = data[i].rowIntValue;
				} else {
					value = data[i].rowStrValue;
				}

				if (sorter[data[i].rowUuid][data[i].name] === undefined) {
					sorter[data[i].rowUuid][data[i].name] = [];
				}

				if ( ! (sorter[data[i].rowUuid][data[i].name] instanceof Array)) {
					sorter[data[i].rowUuid][data[i].name] = [sorter[data[i].rowUuid][data[i].name]];
				}

				sorter[data[i].rowUuid][data[i].name].push(value);
			}

			for (let key in sorter) {
				rows.push(sorter[key]);
			}

			cb(null, rows);
		});
	});
};

// Creates order fields if not already exists in the "orders_orderFields" table.
Order.prototype.createOrderField = function(fieldName, fieldValue, cb) {
	const that = this;

	log.debug('larvitorder: createOrderField() - Creating order field: ' + fieldName);
	ready(function() {
		db.query('INSERT IGNORE INTO orders_orderFields (name) VALUES(?)', [fieldName], function(err) {
			if (err) { cb(err); return; }

			that.insertOrderfieldValue(fieldName, fieldValue, cb);
		});
	});
};

// Inserts order field values to the "orders_orders_fields" table.
Order.prototype.insertOrderfieldValue = function(fieldName, fieldValue, cb) {
	const that = this;

	ready(function() {
		db.query('SELECT * FROM orders_orderFields WHERE name = ?', [fieldName], function(err, result) {
			const sql = 'INSERT INTO orders_orders_fields (orderUuid, fieldId, fieldValue) VALUES(?, ?, ?)';

			if (err) { cb(err); return; }

			log.debug('larvitorder: insertOrderfieldValue() - Writing order field value: ' + fieldName + ' => ' + fieldValue);
			db.query(sql, [new Buffer(uuidLib.parse(that.uuid)), result[0].id, fieldValue], cb);
		});
	});
};

// Creates the order i the "orders" table.
Order.prototype.insertOrder = function(cb) {
	const	that	= this,
		sql	= 'INSERT IGNORE INTO orders (uuid, created) VALUES(?, ?)';

	log.debug('larvitorder: insertOrder() - Writing order: ' + that.uuid);
	ready(function() {
		db.query(sql, [new Buffer(uuidLib.parse(that.uuid)), that.created], cb);
	});
};

// Creates a row i the "orders_rows" table.
Order.prototype.insertRow = function(row, cb) {
	const	that	= this,
		sql	= 'INSERT INTO orders_rows (rowUuid, orderUuid) VALUES(?, ?)';

	if ( ! row.uuid) {
		row.uuid = uuidLib.v4();
	}

	log.debug('larvitorder: insertRow() - Writing row: ' + row.uuid);
	ready(function() {
		db.query(sql, [new Buffer(uuidLib.parse(row.uuid)), new Buffer(uuidLib.parse(that.uuid))], cb);
	});
};

// Creates order fields if not already exists in the "orders_orderFields" table.
Order.prototype.createRowField = function(fieldName, fieldValue, cb) {
	log.debug('larvitorder: createRowField() - Creating row field: ' + fieldName);
	ready(function() {
		db.query('INSERT IGNORE INTO orders_rowFields (name) VALUES(?)', [fieldName], cb);
	});
};

Order.prototype.getOrderFieldId = function(fieldName, cb) {
	const	that	= this;

	ready(function() {
		for (let i = 0; orderFields[i] !== undefined; i ++) {
			if (orderFields[i].name === fieldName) {
				cb(null, orderFields[i].id);
				return;
			}
		}

		// If we get down here, the field does not exist, create it and rerun
		db.query('INSERT IGNORE INTO orders_orderFields (name) VALUES(?)', [fieldName], function(err) {
			if (err) { cb(err); return; }

			loadOrderFieldsToCache(function(err) {
				if (err) { cb(err); return; }

				that.getOrderFieldId(fieldName, cb);
			});
		});
	});
};

/**
 * Get order field ids by names
 *
 * @param arr	fieldNames array of strings
 * @param func	cb(err, object with names as key and ids as values)
 */
Order.prototype.getOrderFieldIds = function(fieldNames, cb) {
	const	fieldIdsByName	= {},
		tasks	= [];

	for (let i = 0; fieldNames[i] !== undefined; i ++) {
		const	fieldName = fieldNames[i];
		tasks.push(function(cb) {
			that.getOrderFieldId(fieldName, function(err, fieldId) {
				if (err) { cb(err); return; }

				fieldIdsByName[fieldName] = fieldId;
			});
		});
	}

	async.parallel(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(null, fieldIdsByName);
	});
};

/**
 * Inserts order field values to the "orders_orders_fields" table.
 *
 * @param str rowUuid
 * @param str fieldName
 * @param str or int fieldValue
 * @param func cb(err, res) - res is from the db query
 */
Order.prototype.insertRowfieldValue = function(rowUuid, fieldName, fieldValue, cb) {
	let	rowIntValue,
		rowStrValue;

	if (fieldValue === parseInt(fieldValue)) {
		rowIntValue	= fieldValue;
		rowStrValue	= null;
	} else {
		rowIntValue	= null;
		rowStrValue	= fieldValue;
	}

	ready(function() {
		db.query('SELECT id FROM orders_rowFields WHERE name = ?', [fieldName], function(err, field) {
			const	dbFields	= [new Buffer(uuidLib.parse(rowUuid)), field[0].id, rowIntValue, rowStrValue],
				sql	= 'INSERT INTO orders_rows_fields (rowUuid, rowFieldId, rowIntValue, rowStrValue) VALUES(?, ?, ?, ?)';

			log.debug('larvitorder: insertRowfieldValue() - Writing row field value: ' + fieldName + ' => ' + fieldValue);
			db.query(sql, dbFields, cb);
		});
	});
};

// Saving the order object to the database.
Order.prototype.save = function(cb) {
	const	tasks	= [],
		that	= this;

	let	fieldIdsByName;

	// Make sure all rows got an uuid
	for (let i = 0; that.rows[i] !== undefined; i ++) {
		let row = that.rows[i];

		if (row.uuid === undefined) {
			row.uuid = uuidLib.v4();
		}
	}

	// Await database readiness
	tasks.push(ready);

	// Make sure the base order row exists
	tasks.push(function(cb) {
		that.insertOrder(cb);
	});

	// Clean out old field data
	tasks.push(function(cb) {
		db.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [lUtils.uuidToBuffer(that.uuid)], cb);
	});

	// Clean out old row field data
	tasks.push(function(cb) {
		const	dbFields	= [lUtils.uuidToBuffer(that.uuid)],
			sql	= 'DELETE FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

		db.query(sql, dbFields, cb);
	});

	// Clean out old rows
	tasks.push(function(cb) {
		const	dbFields	= [lUtils.uuidToBuffer(that.uuid)],
			sql	= 'DELETE FROM orders_rows WHERE orderUuid = ?';

		db.query(sql, dbFields, cb);
	});

	// By now we have a clean database, lets insert stuff!

	// Insert fields
	tasks.push(function(cb) {
		that.getOrderFieldIds(Object.keys(that.fields), function(err, result) {
			fieldIdsByName = result;
			cb(err);
		});
	});
	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_orders_fields (orderUuid, fieldId, fieldValue) VALUES';

		for (const fieldName of Object.keys(that.fields)) {
			if ( ! (that.fields[fieldName] instanceof Array)) {
				that.fields[fieldName] = [that.fields[fieldName]];
			}

			for (let i = 0; that.fields[fieldName][i] !== undefined; i ++) {
				const	fieldValue	= that.fields[fieldName][i];
				sql += '(?,?,?),';
				dbFields.push(that.uuid);
				dbFields.push(fieldIdsByName[fieldName]);
				dbFields.push(fieldValue);
			}
		}

		sql = sql.substring(0, sql.length - 1) + ');';

		db.query(sql, dbFields, cb);
	});

	async.series(tasks, cb);
};

exports = module.exports = Order;
