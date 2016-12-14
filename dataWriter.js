'use strict';

const	EventEmitter	= require('events').EventEmitter,
	intercom	= require('larvitutils').instances.intercom,
	helpers	= require(__dirname + '/helpers.js'),
	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

function rmOrder(params, deliveryTag, msgUuid) {
	const	orderUuid	= params.uuid,
		orderUuidBuf	= lUtils.uuidToBuffer(orderUuid),
		tasks	= [];

	// Delete field data
	tasks.push(function(cb) {
		db.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
	});

	// Delete row field data
	tasks.push(function(cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

		db.query(sql, dbFields, cb);
	});

	// Delete rows
	tasks.push(function(cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows WHERE orderUuid = ?';

		db.query(sql, dbFields, cb);
	});

	// Delete order
	tasks.push(function(cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders WHERE uuid = ?';

		db.query(sql, dbFields, cb);
	});

	async.series(tasks, function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function writeOrder(params, deliveryTag, msgUuid) {
	const	orderFields	= params.fields,
		orderRows	= params.rows,
		orderUuid	= params.uuid,
		orderUuidBuf	= lUtils.uuidToBuffer(orderUuid),
		created	= params.created,
		tasks	= [];

	let	fieldUuidsByName,
		rowFieldUuidsByName;

	if (lUtils.formatUuid(orderUuid) === false || orderUuidBuf === false) {
		const err = new Error('Invalid orderUuid: "' + orderUuid + '"');
		log.error('larvitorder: ./dataWriter.js - writeOrder() - ' + err.message);
		exports.emitter.emit(orderUuid, err);
		return;
	}

	// Make sure the base order row exists
	tasks.push(function(cb) {
		const	sql	= 'INSERT IGNORE INTO orders (uuid, created) VALUES(?,?)';

		db.query(sql, [orderUuidBuf, created], cb);
	});

	// Clean out old field data
	tasks.push(function(cb) {
		db.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
	});

	// Clean out old row field data
	tasks.push(function(cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

		db.query(sql, dbFields, cb);
	});

	// Clean out old rows
	tasks.push(function(cb) {
		const	dbFields	= [orderUuidBuf],
			sql	= 'DELETE FROM orders_rows WHERE orderUuid = ?';

		db.query(sql, dbFields, cb);
	});

	// By now we have a clean database, lets insert stuff!

	// Get all field ids
	tasks.push(function(cb) {
		helpers.getOrderFieldUuids(Object.keys(orderFields), function(err, result) {
			fieldUuidsByName = result;
			cb(err);
		});
	});

	// Insert fields
	tasks.push(function(cb) {
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

		if (dbFields.length === 0) {
			cb();
			return;
		}

		sql = sql.substring(0, sql.length - 1) + ';';
		db.query(sql, dbFields, cb);
	});

	// Insert rows
	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_rows (rowUuid, orderUuid) VALUES';

		for (let i = 0; orderRows[i] !== undefined; i ++) {
			const row = orderRows[i];

			// Make sure all rows got an uuid
			if (row.uuid === undefined) {
				row.uuid = uuidLib.v1();
			}

			sql += '(?,?),';
			dbFields.push(lUtils.uuidToBuffer(row.uuid));
			dbFields.push(orderUuidBuf);
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

		for (let i = 0; orderRows[i] !== undefined; i ++) {
			const	row	= orderRows[i];

			for (const rowFieldName of Object.keys(row)) {
				if (rowFieldNames.indexOf(rowFieldName) === - 1) {
					rowFieldNames.push(rowFieldName);
				}
			}
		}

		helpers.getRowFieldUuids(rowFieldNames, function(err, result) {
			rowFieldUuidsByName = result;
			cb(err);
		});
	});

	// Insert row fields
	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUES';

		for (let i = 0; orderRows[i] !== undefined; i ++) {
			const	row	= orderRows[i];

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

	async.series(tasks, function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function writeOrderField(params, deliveryTag, msgUuid) {
	const	uuid	= params.uuid,
		name	= params.name;

	db.query('INSERT IGNORE INTO orders_orderFields (uuid, name) VALUES(?,?)', [uuid, name], function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function writeRowField(params, deliveryTag, msgUuid) {
	const	uuid	= params.uuid,
		name	= params.name;

	db.query('INSERT IGNORE INTO orders_rowFields (uuid, name) VALUES(?,?)', [uuid, name], function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvitorder';
exports.rmOrder	= rmOrder;
exports.writeOrder	= writeOrder;
exports.writeOrderField	= writeOrderField;
exports.writeRowField	= writeRowField;

intercom.subscribe({'exchange': exports.exchangeName}, function(message, ack, deliveryTag) {
	ack(); // Ack first, if something goes wrong we log it and handle it manually

	if (typeof message !== 'object') {
		log.error('larvitorder: dataWriter.js - intercom.subscribe() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
		return;
	}

	if (typeof exports[message.action] === 'function') {
		exports[message.action](message.params, deliveryTag, message.uuid);
	} else {
		log.warn('larvitorder: dataWriter.js - intercom.subscribe() - Unknown message.action received: "' + message.action + '"');
	}
});
