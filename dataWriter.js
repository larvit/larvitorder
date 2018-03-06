'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	topLogPrefix	= 'larvitorder: dataWriter.js: ',
	DbMigration	= require('larvitdbmigration'),
	Intercom	= require('larvitamintercom'),
	checkKey	= require('check-object-key'),
	helpers	= require(__dirname + '/helpers.js'),
	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils'),
	amsync	= require('larvitamsync'),
	async	= require('async'),
	that	= this,
	log	= require('winston'),
	db	= require('larvitdb');

let	readyInProgress	= false,
	isReady	= false;

function listenToQueue(retries, cb) {
	const	logPrefix	= topLogPrefix + 'listenToQueue() - ',
		options	= {'exchange': exports.exchangeName},
		tasks	= [];

	let	listenMethod;

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
	}

	if (retries === undefined) {
		retries = 0;
	}

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'mode',
			'validValues':	['master', 'slave', 'noSync'],
			'default':	'noSync'
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'intercom',
			'default':	new Intercom('loopback interface'),
			'defaultLabel':	'loopback interface'
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	tasks.push(function (cb) {
		if (exports.mode === 'master') {
			listenMethod	= 'consume';
			options.exclusive	= true;	// It is important no other client tries to sneak
			//		// out messages from us, and we want "consume"
			//		// since we want the queue to persist even if this
			//		// minion goes offline.
		} else if (exports.mode === 'slave' || exports.mode === 'noSync') {
			listenMethod = 'subscribe';
		}

		log.info(logPrefix + 'listenMethod: ' + listenMethod);

		cb();
	});

	async.series(tasks, function (err) {
		if (err) throw err;

		exports.intercom.ready(function (err) {
			if (err) {
				log.error(logPrefix + 'intercom.ready() err: ' + err.message);
				return;
			}

			exports.intercom[listenMethod](options, function (message, ack, deliveryTag) {
				exports.ready(function (err) {
					ack(err); // Ack first, if something goes wrong we log it and handle it manually

					if (err) {
						log.error(logPrefix + 'intercom.' + listenMethod + '() - exports.ready() returned err: ' + err.message);
						return;
					}

					if (typeof message !== 'object') {
						log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
						return;
					}

					if (typeof exports[message.action] === 'function') {
						exports[message.action](message.params, deliveryTag, message.uuid);
					} else {
						log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
					}
				});
			}, ready);
		});
	});
}
setImmediate(listenToQueue);

// This is ran before each incoming message on the queue is handeled
function ready(retries, cb) {
	const	logPrefix	= topLogPrefix + 'ready() - ',
		tasks	= [];

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
	}

	if (retries === undefined) {
		retries	= 0;
	}

	if (isReady === true) return cb();

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	readyInProgress = true;

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'mode',
			'validValues':	['master', 'slave', 'noSync'],
			'default':	'noSync'
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	tasks.push(function (cb) {
		checkKey({
			'obj':	exports,
			'objectKey':	'intercom',
			'default':	new Intercom('loopback interface'),
			'defaultLabel':	'loopback interface'
		}, function (err, warning) {
			if (warning) log.warn(logPrefix + warning);
			cb(err);
		});
	});

	tasks.push(function (cb) {
		if (exports.mode === 'slave') {
			log.verbose(logPrefix + 'exports.mode: "' + exports.mode + '", so read');
			amsync.mariadb({
				'exchange':	exports.exchangeName + '_dataDump',
				'intercom':	exports.intercom
			}, cb);
		} else {
			cb();
		}
	});

	// Migrate database
	tasks.push(function (cb) {
		const	options	= {};

		let	dbMigration;

		options.dbType	= 'larvitdb';
		options.dbDriver	= db;
		options.tableName	= 'orders_db_version';
		options.migrationScriptsPath	= __dirname + '/dbmigration';
		dbMigration	= new DbMigration(options);

		dbMigration.run(function (err) {
			if (err) {
				log.error(logPrefix + 'Database error: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function (err) {
		if (err) return;

		isReady	= true;
		eventEmitter.emit('ready');

		if (exports.mode === 'master') {
			runDumpServer(cb);
		} else {
			cb();
		}
	});
}

function rmOrder(params, deliveryTag, msgUuid) {
	const	orderUuid	= params.uuid,
		orderUuidBuf	= lUtils.uuidToBuffer(orderUuid),
		tasks	= [];

	if (orderUuidBuf === false) {
		const err = new Error('Invalid order uuid');
		log.warn(topLogPrefix + 'rmOrder() - ' + err.message);
		return exports.emitter.emit(msgUuid, err);
	}

	// Delete field data
	tasks.push(function (cb) {
		db.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
	});

	// Delete row field data
	tasks.push(function (cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

		db.query(sql, dbFields, cb);
	});

	// Delete rows
	tasks.push(function (cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows WHERE orderUuid = ?';

		db.query(sql, dbFields, cb);
	});

	// Delete order
	tasks.push(function (cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders WHERE uuid = ?';

		db.query(sql, dbFields, cb);
	});

	async.series(tasks, function (err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function runDumpServer(cb) {
	const	options	= {
			'exchange':	exports.exchangeName + '_dataDump',
			'host':	that.options.amsync	? that.options.amsync.host	: null,
			'minPort':	that.options.amsync	? that.options.amsync.minPort	: null,
			'maxPort':	that.options.amsync	? that.options.amsync.maxPort	: null
		},
		args	= [];

	if (db.conf.host) {
		args.push('-h');
		args.push(db.conf.host);
	}

	args.push('-u');
	args.push(db.conf.user);

	if (db.conf.password) {
		args.push('-p' + db.conf.password);
	}

	args.push('--single-transaction');
	args.push('--hex-blob');
	args.push(db.conf.database);

	// Tables
	args.push('orders');
	args.push('orders_db_version');
	args.push('orders_orderFields');
	args.push('orders_orders_fields');
	args.push('orders_rowFields');
	args.push('orders_rows');
	args.push('orders_rows_fields');

	options.dataDumpCmd = {
		'command':	'mysqldump',
		'args':	args
	};

	options['Content-Type'] = 'application/sql';
	options.intercom	= exports.intercom;

	new amsync.SyncServer(options, cb);
}

function writeOrder(params, deliveryTag, msgUuid, cb) {
	const	orderFields	= params.fields,
		logPrefix	= topLogPrefix + 'writeOrder() - ',
		orderRows	= params.rows,
		orderUuid	= params.uuid,
		orderUuidBuf	= lUtils.uuidToBuffer(orderUuid),
		created	= params.created,
		tasks	= [];

	let	rowFieldUuidsByName,
		fieldUuidsByName,
		dbCon;

	if (typeof cb !== 'function') {
		cb = function () {};
	}

	if (lUtils.formatUuid(orderUuid) === false || orderUuidBuf === false) {
		const err = new Error('Invalid orderUuid: "' + orderUuid + '"');
		log.error(logPrefix + err.message);
		exports.emitter.emit(orderUuid, err);
		return;
	}

	// Get all field uuids
	tasks.push(function (cb) {
		helpers.getOrderFieldUuids(Object.keys(orderFields), function (err, result) {
			fieldUuidsByName	= result;
			cb(err);
		});
	});

	// Get all row field uuids
	tasks.push(function (cb) {
		const	rowFieldNames	= [];

		for (let i = 0; orderRows[i] !== undefined; i ++) {
			const	row	= orderRows[i];

			for (const rowFieldName of Object.keys(row)) {
				if (rowFieldNames.indexOf(rowFieldName) === - 1) {
					rowFieldNames.push(rowFieldName);
				}
			}
		}

		helpers.getRowFieldUuids(rowFieldNames, function (err, result) {
			rowFieldUuidsByName = result;
			cb(err);
		});
	});

	// Get a database connection
	tasks.push(function (cb) {
		db.pool.getConnection(function(err, result) {
			dbCon	= result;
			cb(err);
		});
	});

	// Lock tables
	tasks.push(function (cb) {
		dbCon.query('LOCK TABLES orders WRITE, orders_orders_fields WRITE, orders_rows_fields WRITE, orders_rows WRITE', cb);
	});

	// Make sure the base order row exists
	tasks.push(function (cb) {
		const	sql	= 'INSERT IGNORE INTO orders (uuid, created) VALUES(?,?)';

		dbCon.query(sql, [orderUuidBuf, created], cb);
	});

	// Clean out old field data
	tasks.push(function (cb) {
		dbCon.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
	});

	// Clean out old row field data
	tasks.push(function (cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

		dbCon.query(sql, dbFields, cb);
	});

	// Clean out old rows
	tasks.push(function (cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows WHERE orderUuid = ?';

		dbCon.query(sql, dbFields, cb);
	});

	// By now we have a clean database, lets insert stuff!

	// Insert fields
	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_orders_fields (orderUuid, fieldUuid, fieldValue) VALUES';

		for (const fieldName of Object.keys(orderFields)) {
			if ( ! (orderFields[fieldName] instanceof Array)) {
				orderFields[fieldName] = [orderFields[fieldName]];
			}

			for (let i = 0; orderFields[fieldName][i] !== undefined; i ++) {
				const	fieldValue	= orderFields[fieldName][i];
				sql += '(?,?,?),';
				dbFields.push(orderUuidBuf);
				dbFields.push(fieldUuidsByName[fieldName]);
				dbFields.push(fieldValue);
			}
		}

		if (dbFields.length === 0) return cb();

		sql = sql.substring(0, sql.length - 1) + ';';
		dbCon.query(sql, dbFields, cb);
	});

	// Insert rows
	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_rows (rowUuid, orderUuid) VALUES';

		for (let i = 0; orderRows[i] !== undefined; i ++) {
			const row = orderRows[i];

			let buffer;

			// Make sure all rows got an uuid
			if (row.uuid === undefined) {
				row.uuid = uuidLib.v4();
			}

			buffer = lUtils.uuidToBuffer(row.uuid);

			if (buffer === false) {
				return cb(new Error('Invalid row uuid'));
			}

			sql += '(?,?),';
			dbFields.push(buffer);
			dbFields.push(orderUuidBuf);
		}

		if (dbFields.length === 0) return cb();

		sql = sql.substring(0, sql.length - 1);
		dbCon.query(sql, dbFields, cb);
	});

	// Insert row fields
	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUES';

		for (let i = 0; orderRows[i] !== undefined; i ++) {
			const	row	= orderRows[i];

			for (const rowFieldName of Object.keys(row)) {
				const	rowUuidBuff	= lUtils.uuidToBuffer(row.uuid);

				if (rowUuidBuff === false) {
					return cb(new Error('Invalid row uuid'));
				}

				if (rowFieldName === 'uuid') continue;

				if ( ! (row[rowFieldName] instanceof Array)) {
					row[rowFieldName] = [row[rowFieldName]];
				}

				for (let i = 0; row[rowFieldName][i] !== undefined; i ++) {
					const rowFieldValue = row[rowFieldName][i];

					sql += '(?,?,?,?),';
					dbFields.push(rowUuidBuff);
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

		if (dbFields.length === 0) return cb();

		sql = sql.substring(0, sql.length - 1) + ';';

		dbCon.query(sql, dbFields, function (err) {
			if (err) {
				try {
					log.error(logPrefix + 'db err: ' + err.message);
					log.error(logPrefix + 'Full order params: ' + JSON.stringify(params));
				} catch (err) {
					log.error(logPrefix + 'Could not log proder params: ' + err.message);
				}
			}

			cb(err);
		});
	});

	// Unlock tables
	tasks.push(function (cb) {
		dbCon.query('UNLOCK TABLES', cb);
	});

	async.series(tasks, function (err) {
		if (dbCon) {
			dbCon.release();
		}
		exports.emitter.emit(msgUuid, err);
		return cb(err);
	});
}

function writeOrderField(params, deliveryTag, msgUuid) {
	const	uuid	= params.uuid,
		name	= params.name;

	db.query('INSERT IGNORE INTO orders_orderFields (uuid, name) VALUES(?,?)', [uuid, name], function (err) {
		if (err) {
			exports.emitter.emit(msgUuid, err);
			return;
		}

		helpers.loadOrderFieldsToCache(function (err) {
			exports.emitter.emit(msgUuid, err);
		});
	});
}

function writeRowField(params, deliveryTag, msgUuid) {
	const	uuid	= params.uuid,
		name	= params.name;

	db.query('INSERT IGNORE INTO orders_rowFields (uuid, name) VALUES(?,?)', [uuid, name], function (err) {
		if (err) {
			exports.emitter.emit(msgUuid, err);
			return;
		}

		helpers.loadRowFieldsToCache(function (err) {
			exports.emitter.emit(msgUuid, err);
		});
	});
}

exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvitorder';
exports.options	= undefined;
exports.ready	= ready;
exports.rmOrder	= rmOrder;
exports.writeOrder	= writeOrder;
exports.writeOrderField	= writeOrderField;
exports.writeRowField	= writeRowField;
