'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	dbmigration	= require('larvitdbmigration')({'tableName': 'orders_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	orderFields	= [],
	rowFields	= [],
	intercom	= require('larvitutils').instances.intercom,
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

	// Load row fields
	tasks.push(loadRowFieldsToCache);

	async.series(tasks, function() {
		isReady	= true;
		eventEmitter.emit('ready');
		cb();
	});
}

function loadOrderFieldsToCache(cb) {
	db.query('SELECT * FROM orders_orderFields ORDER BY name;', function(err, rows) {
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

function loadRowFieldsToCache(cb) {
	db.query('SELECT * FROM orders_rowFields ORDER BY name;', function(err, rows) {
		if (err) {
			log.error('larvitorder: orders.js: Database error: ' + err.message);
			return;
		}

		// Empty the previous cache
		rowFields.length = 0;

		// Load the new values
		for (let i = 0; rows[i] !== undefined; i ++) {
			rowFields.push(rows[i]);
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
	this.ready	= ready; // To expose to the outside world
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
	sql += '		ON orders_orders_fields.fieldUuid = orders_orderFields.uuid\n';
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

	sql += 'SELECT orders_rows.rowUuid AS uuid, orders_rows_fields.rowStrValue, orders_rows_fields.rowIntValue, orders_rowFields.name\n';
	sql += 'FROM orders_rows\n';
	sql += '	INNER JOIN orders_rows_fields\n';
	sql += '		ON orders_rows_fields.rowUuid = orders_rows.rowUuid\n';
	sql += '	INNER JOIN orders_rowFields\n';
	sql += '		ON orders_rowFields.uuid = orders_rows_fields.rowFieldUuid\n';
	sql += 'WHERE orders_rows.orderUuid = ?';

	ready(function() {
		db.query(sql, [new Buffer(uuidLib.parse(that.uuid))], function(err, data) {
			if (err) { cb(err); return; }

			for (let i = 0; data.length > i; i ++) {
				let value;

				data[i].uuid = uuidLib.unparse(data[i].uuid);

				if (sorter[data[i].uuid] === undefined) {
					sorter[data[i].uuid] = {
						'uuid': data[i].uuid
					};
				}

				if (data[i].rowStrValue === null) {
					value = data[i].rowIntValue;
				} else {
					value = data[i].rowStrValue;
				}

				if (sorter[data[i].uuid][data[i].name] === undefined) {
					sorter[data[i].uuid][data[i].name] = [];
				}

				if ( ! (sorter[data[i].uuid][data[i].name] instanceof Array)) {
					sorter[data[i].uuid][data[i].name] = [sorter[data[i].uuid][data[i].name]];
				}

				sorter[data[i].uuid][data[i].name].push(value);
			}

			for (let key in sorter) {
				rows.push(sorter[key]);
			}

			cb(null, rows);
		});
	});
};

Order.prototype.getOrderFieldUuid = function(fieldName, cb) {
	const	that	= this;

	ready(function() {
		for (let i = 0; orderFields[i] !== undefined; i ++) {
			if (orderFields[i].name === fieldName) {
				cb(null, orderFields[i].uuid);
				return;
			}
		}

		// If we get down here, the field does not exist, create it and rerun
		db.query('INSERT IGNORE INTO orders_orderFields (uuid, name) VALUES(?,?)', [uuidLib.v4(), fieldName], function(err) {
			if (err) { cb(err); return; }

			loadOrderFieldsToCache(function(err) {
				if (err) { cb(err); return; }

				that.getOrderFieldUuid(fieldName, cb);
			});
		});
	});
};

/**
 * Get order field ids by names
 *
 * @param arr	fieldNames array of strings
 * @param func	cb(err, object with names as key and uuids as values)
 */
Order.prototype.getOrderFieldUuids = function(fieldNames, cb) {
	const	fieldUuidsByName	= {},
		tasks	= [],
		that	= this;;

	for (let i = 0; fieldNames[i] !== undefined; i ++) {
		const	fieldName = fieldNames[i];

		tasks.push(function(cb) {
			that.getOrderFieldUuid(fieldName, function(err, fieldUuid) {
				if (err) { cb(err); return; }

				fieldUuidsByName[fieldName] = fieldUuid;
				cb();
			});
		});
	}

	async.parallel(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(null, fieldUuidsByName);
	});
};

Order.prototype.getRowFieldUuid = function(rowFieldName, cb) {
	const	that	= this;

	if (rowFieldName === 'uuid') {
		const	err	= new Error('Row field "uuid" is reserved and have no uuid');
		log.warn('larvitorder: order.js - getRowFieldUuid() - ' + err.message);
		cb(err);
		return;
	}

	ready(function() {
		for (let i = 0; rowFields[i] !== undefined; i ++) {
			if (rowFields[i].name === rowFieldName) {
				cb(null, rowFields[i].uuid);
				return;
			}
		}

		// If we get down here, the field does not exist, create it and rerun
		db.query('INSERT IGNORE INTO orders_rowFields (uuid, name) VALUES(?,?)', [uuidLib.v4(), rowFieldName], function(err) {
			if (err) { cb(err); return; }

			loadRowFieldsToCache(function(err) {
				if (err) { cb(err); return; }

				that.getRowFieldUuid(rowFieldName, cb);
			});
		});
	});
};

/**
 * Get row field ids by names
 *
 * @param arr	rowFieldNames array of strings
 * @param func	cb(err, object with names as key and ids as values)
 */
Order.prototype.getRowFieldUuids = function(rowFieldNames, cb) {
	const	rowFieldUuidsByName	= {},
		tasks	= [],
		that	= this;;

	for (let i = 0; rowFieldNames[i] !== undefined; i ++) {
		const	rowFieldName = rowFieldNames[i];

		if (rowFieldName === 'uuid') continue; // Ignore uuid

		tasks.push(function(cb) {
			that.getRowFieldUuid(rowFieldName, function(err, fieldUuid) {
				if (err) { cb(err); return; }

				rowFieldUuidsByName[rowFieldName] = fieldUuid;
				cb();
			});
		});
	}

	async.parallel(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(null, rowFieldUuidsByName);
	});
};

// Saving the order object to the database.
Order.prototype.save = function(cb) {
	const	tasks	= [],
		that	= this;

	let	fieldUuidsByName,
		rowFieldUuidsByName;

	// Await database readiness
	tasks.push(ready);

	tasks.push(function(cb) {
		intercom.send({
			'action':	'writeOrder',
			'params':	[
				that.uuid,
				that.created,
				that.fields,
				that.rows
			]
		}, function(err, msgUuid) {
			cb(err);
		});
	});

	// Make sure the base order row exists
	tasks.push(function(cb) {
		const	sql	= 'INSERT IGNORE INTO orders (uuid, created) VALUES(?,?)';

		db.query(sql, [lUtils.uuidToBuffer(that.uuid), that.created], cb);
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

	// Get all field ids
	tasks.push(function(cb) {
		that.getOrderFieldUuids(Object.keys(that.fields), function(err, result) {
			fieldUuidsByName = result;

			cb(err);
		});
	});

	// Insert fields
	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_orders_fields (orderUuid, fieldUuid, fieldValue) VALUES';

		for (const fieldName of Object.keys(that.fields)) {
			if ( ! (that.fields[fieldName] instanceof Array)) {
				that.fields[fieldName] = [that.fields[fieldName]];
			}

			for (let i = 0; that.fields[fieldName][i] !== undefined; i ++) {
				const	fieldValue	= that.fields[fieldName][i];
				sql += '(?,?,?),';
				dbFields.push(lUtils.uuidToBuffer(that.uuid));
				dbFields.push(fieldUuidsByName[fieldName]);
				dbFields.push(fieldValue);
			}
		}

		sql = sql.substring(0, sql.length - 1) + ';';

		db.query(sql, dbFields, cb);
	});

	// Insert rows
	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_rows (rowUuid, orderUuid) VALUES';

		for (let i = 0; that.rows[i] !== undefined; i ++) {
			const row = that.rows[i];

			// Make sure all rows got an uuid
			if (row.uuid === undefined) {
				row.uuid = uuidLib.v4();
			}

			sql += '(?,?),';
			dbFields.push(lUtils.uuidToBuffer(row.uuid));
			dbFields.push(lUtils.uuidToBuffer(that.uuid));
		}

		if (dbFields.length === 0) {
			cb();
			return;
		}

		sql = sql.substring(0, sql.length - 1);
		db.query(sql, dbFields, cb);
	});

	// Get all row field uuids
	tasks.push(function(cb) {
		const	rowFieldNames	= [];

		for (let i = 0; that.rows[i] !== undefined; i ++) {
			const	row	= that.rows[i];

			for (const rowFieldName of Object.keys(row)) {
				if (rowFieldNames.indexOf(rowFieldName) === - 1) {
					rowFieldNames.push(rowFieldName);
				}
			}
		}

		that.getRowFieldUuids(rowFieldNames, function(err, result) {
			rowFieldUuidsByName = result;
			cb(err);
		});
	});

	// Insert row fields
	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUES';

		for (let i = 0; that.rows[i] !== undefined; i ++) {
			const	row	= that.rows[i];

			for (const rowFieldName of Object.keys(row)) {
				if (rowFieldName === 'uuid') continue;

				if ( ! (row[rowFieldName] instanceof Array)) {
					row[rowFieldName] = [row[rowFieldName]];
				}

				for (let i = 0; row[rowFieldName][i] !== undefined; i ++) {
					const rowFieldValue = row[rowFieldName][i];

					sql += '(?,?,?,?),';
					dbFields.push(lUtils.uuidToBuffer(row.uuid));
					dbFields.push(rowFieldUuidsByName[rowFieldName]);

					if (typeof rowFieldValue === 'number' && (rowFieldValue % 1) === 0) {
						dbFields.push(rowFieldValue);
						dbFields.push(null);
					} else {
						dbFields.push(null);
						dbFields.push(rowFieldValue);
					}
				}
			}
		}

		if (dbFields.length === 0) {
			cb();
			return;
		}

		sql = sql.substring(0, sql.length - 1) + ';';

		db.query(sql, dbFields, cb);
	});

	async.series(tasks, cb);
};

exports = module.exports = Order;
