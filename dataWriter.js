'use strict';

const EventEmitter = require('events').EventEmitter;
const topLogPrefix = 'larvitorder: dataWriter.js: ';
const DbMigration = require('larvitdbmigration');
const Intercom = require('larvitamintercom');
const Helpers = require('./helpers.js');
const uuidLib = require('uuid');
const LUtils = require('larvitutils');
const amsync = require('larvitamsync');
const async = require('async');

let emitter = new EventEmitter();
let isReady = false;
let readyInProgress = false;

class DataWriter {
	static get emitter() { return emitter; }

	constructor(options, cb) {
		if (!options.db) return cb(new Error('Missing required option "db"'));
		if (!options.mode) return cb(new Error('Missing required option "mode"'));

		if (!options.log) {
			const tmpLUtils = new LUtils();

			options.log = new tmpLUtils.Log();
		}

		if (!options.intercom) {
			options.intercom = new Intercom('loopback interface');
		}

		if (!options.exchangeName) {
			options.exchangeName = 'larvitorder';
		}

		this.options = options;

		for (const key of Object.keys(options)) {
			this[key] = options[key];
		}

		this.lUtils = new LUtils({log: this.log});

		this.helpers = new Helpers({log: this.log, db: this.db, dataWriter: this});

		this.listenToQueue(cb);
	}

	listenToQueue(retries, cb) {
		const logPrefix = topLogPrefix + 'listenToQueue() - ';
		const options = {exchange: this.exchangeName};
		const tasks = [];

		let listenMethod;

		if (typeof retries === 'function') {
			cb = retries;
			retries = 0;
		}

		if (typeof cb !== 'function') {
			cb = () => {};
		}

		if (retries === undefined) {
			retries = 0;
		}

		tasks.push(cb => {
			if (this.mode === 'master') {
				listenMethod = 'consume';
				options.exclusive = true; // It is important no other client tries to sneak
				// out messages from us, and we want "consume"
				// since we want the queue to persist even if this
				// minion goes offline.
			} else if (this.mode === 'slave' || this.mode === 'noSync') {
				listenMethod = 'subscribe';
			}

			this.log.info(logPrefix + 'listenMethod: ' + listenMethod);

			cb();
		});

		async.series(tasks, err => {
			if (err) throw err;

			this.intercom.ready(err => {
				if (err) {
					this.log.error(logPrefix + 'intercom.ready() err: ' + err.message);

					return;
				}

				this.intercom[listenMethod](options, (message, ack, deliveryTag) => {
					this.ready(err => {
						ack(err); // Ack first, if something goes wrong we log it and handle it manually

						if (err) {
							this.log.error(logPrefix + 'intercom.' + listenMethod + '() - this.ready() returned err: ' + err.message);

							return;
						}

						if (typeof message !== 'object') {
							this.log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');

							return;
						}

						if (typeof this[message.action] === 'function') {
							this[message.action](message.params, deliveryTag, message.uuid);
						} else {
							this.log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
						}
					});
				}, cb);
			});
		});
	}

	ready(retries, cb) {
		const logPrefix = topLogPrefix + 'ready() - ';
		const tasks = [];

		if (typeof retries === 'function') {
			cb = retries;
			retries = 0;
		}

		if (typeof cb !== 'function') {
			cb = () => {};
		}

		if (retries === undefined) {
			retries = 0;
		}

		if (isReady === true) return cb();

		if (readyInProgress === true) {
			DataWriter.emitter.on('ready', cb);

			return;
		}

		readyInProgress = true;

		tasks.push(cb => {
			if (this.mode === 'slave') {
				this.log.verbose(logPrefix + 'this.mode: "' + this.mode + '", so read');
				amsync.mariadb({
					exchange: this.exchangeName + '_dataDump',
					intercom: this.intercom
				}, cb);
			} else {
				cb();
			}
		});

		// Migrate database
		tasks.push(cb => {
			const options = {};

			let dbMigration;

			options.dbType = 'mariadb';
			options.dbDriver = this.db;
			options.log = this.log;
			options.tableName = 'orders_db_version';
			options.migrationScriptsPath = __dirname + '/dbmigration';
			dbMigration = new DbMigration(options);

			dbMigration.run(err => {
				if (err) {
					this.log.error(logPrefix + 'Database error: ' + err.message);
				}

				cb(err);
			});
		});

		async.series(tasks, err => {
			if (err) return;

			isReady = true;
			DataWriter.emitter.emit('ready');

			if (this.mode === 'master') {
				this.runDumpServer(cb);
			} else {
				cb();
			}
		});
	};

	rmOrder(params, deliveryTag, msgUuid) {
		const orderUuid = params.uuid;
		const orderUuidBuf = this.lUtils.uuidToBuffer(orderUuid);
		const tasks = [];

		if (orderUuidBuf === false) {
			const err = new Error('Invalid order uuid');

			this.log.warn(topLogPrefix + 'rmOrder() - ' + err.message);

			return emitter.emit(msgUuid, err);
		}

		// Delete field data
		tasks.push(cb => {
			this.db.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
		});

		// Delete row field data
		tasks.push(cb => {
			const dbFields = [orderUuidBuf];
			const sql = 'DELETE FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

			this.db.query(sql, dbFields, cb);
		});

		// Delete rows
		tasks.push(cb => {
			const dbFields = [orderUuidBuf];
			const sql = 'DELETE FROM orders_rows WHERE orderUuid = ?';

			this.db.query(sql, dbFields, cb);
		});

		// Delete order
		tasks.push(cb => {
			const dbFields = [orderUuidBuf];
			const sql = 'DELETE FROM orders WHERE uuid = ?';

			this.db.query(sql, dbFields, cb);
		});

		async.series(tasks, err => {
			emitter.emit(msgUuid, err);
		});
	};

	runDumpServer(cb) {
		const options = {
			exchange: this.exchangeName + '_dataDump',
			host: this.options.amsync ? this.options.amsync.host : null,
			minPort: this.options.amsync ? this.options.amsync.minPort : null,
			maxPort: this.options.amsync ? this.options.amsync.maxPort : null
		};
		const args = [];

		if (this.db.conf.host) {
			args.push('-h');
			args.push(this.db.conf.host);
		}

		args.push('-u');
		args.push(this.db.conf.user);

		if (this.db.conf.password) {
			args.push('-p' + this.db.conf.password);
		}

		args.push('--single-transaction');
		args.push('--hex-blob');
		args.push(this.db.conf.database);

		// Tables
		args.push('orders');
		args.push('orders_db_version');
		args.push('orders_orderFields');
		args.push('orders_orders_fields');
		args.push('orders_rowFields');
		args.push('orders_rows');
		args.push('orders_rows_fields');

		options.dataDumpCmd = {
			command: 'mysqldump',
			args: args
		};

		options['Content-Type'] = 'application/sql';
		options.intercom = this.intercom;

		new amsync.SyncServer(options, cb);
	};

	writeOrder(params, deliveryTag, msgUuid, cb) {
		const orderFields = params.fields;
		const logPrefix = topLogPrefix + 'writeOrder() - ';
		const orderRows = params.rows;
		const orderUuid = params.uuid;
		const orderUuidBuf = this.lUtils.uuidToBuffer(orderUuid);
		const created = params.created;
		const tasks = [];

		let rowFieldUuidsByName;
		let fieldUuidsByName;
		let dbCon;

		if (typeof cb !== 'function') {
			cb = () => {};
		}

		if (this.lUtils.formatUuid(orderUuid) === false || orderUuidBuf === false) {
			const err = new Error('Invalid orderUuid: "' + orderUuid + '"');

			this.log.error(logPrefix + err.message);
			emitter.emit(orderUuid, err);

			return;
		}

		if (this.lUtils.formatUuid(orderUuid) === false || orderUuidBuf === false) {
			const err = new Error('Invalid orderUuid: "' + orderUuid + '"');

			this.log.error(logPrefix + err.message);
			emitter.emit(orderUuid, err);

			return;
		}

		if (created && !created instanceof Date) {
			const err = new Error('Invalid value of "created". Value must be an instance of Date.');

			this.log.warn(logPrefix + err.message);
			emitter.emit(orderUuid, err);

			return;
		}

		tasks.push(cb => { this.ready(cb); });

		// Get all field uuids
		tasks.push(cb => {
			this.helpers.getOrderFieldUuids(Object.keys(orderFields), (err, result) => {
				fieldUuidsByName = result;
				cb(err);
			});
		});

		// Get all row field uuids
		tasks.push(cb => {
			const rowFieldNames = [];

			for (let i = 0; orderRows[i] !== undefined; i++) {
				const row = orderRows[i];

				for (const rowFieldName of Object.keys(row)) {
					if (rowFieldNames.indexOf(rowFieldName) === -1) {
						rowFieldNames.push(rowFieldName);
					}
				}
			}

			this.helpers.getRowFieldUuids(rowFieldNames, (err, result) => {
				rowFieldUuidsByName = result;
				cb(err);
			});
		});

		// Get a database connection
		tasks.push(cb => {
			this.db.pool.getConnection((err, result) => {
				dbCon = result;
				cb(err);
			});
		});

		// Lock tables
		tasks.push(cb => {
			dbCon.query('LOCK TABLES orders WRITE, orders_orders_fields WRITE, orders_rows_fields WRITE, orders_rows WRITE', cb);
		});

		// Make sure the base order row exists
		tasks.push(cb => {
			const sql = 'INSERT IGNORE INTO orders (uuid, created) VALUES(?,?)';

			dbCon.query(sql, [orderUuidBuf, created], cb);
		});

		// Clean out old field data
		tasks.push(cb => {
			dbCon.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
		});

		// Clean out old row field data
		tasks.push(cb => {
			const dbFields = [orderUuidBuf];
			const sql = 'DELETE FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

			dbCon.query(sql, dbFields, cb);
		});

		// Clean out old rows
		tasks.push(cb => {
			const dbFields = [orderUuidBuf];
			const sql = 'DELETE FROM orders_rows WHERE orderUuid = ?';

			dbCon.query(sql, dbFields, cb);
		});

		// By now we have a clean database, lets insert stuff!

		// Insert fields
		tasks.push(cb => {
			const dbFields = [];

			let sql = 'INSERT INTO orders_orders_fields (orderUuid, fieldUuid, fieldValue) VALUES';

			for (const fieldName of Object.keys(orderFields)) {
				if (!(orderFields[fieldName] instanceof Array)) {
					orderFields[fieldName] = [orderFields[fieldName]];
				}

				for (let i = 0; orderFields[fieldName][i] !== undefined; i++) {
					const fieldValue = orderFields[fieldName][i];

					if (fieldValue === null || fieldValue === undefined) continue;

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
		tasks.push(cb => {
			const dbFields = [];

			let sql = 'INSERT INTO orders_rows (rowUuid, orderUuid) VALUES';

			for (let i = 0; orderRows[i] !== undefined; i++) {
				const row = orderRows[i];

				let buffer;

				// Make sure all rows got an uuid
				if (row.uuid === undefined) {
					row.uuid = uuidLib.v4();
				}

				buffer = this.lUtils.uuidToBuffer(row.uuid);

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
		tasks.push(cb => {
			const dbFields = [];

			let sql = 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUES';

			for (let i = 0; orderRows[i] !== undefined; i++) {
				const row = orderRows[i];

				for (const rowFieldName of Object.keys(row)) {
					const rowUuidBuff = this.lUtils.uuidToBuffer(row.uuid);

					if (rowUuidBuff === false) {
						return cb(new Error('Invalid row uuid'));
					}

					if (rowFieldName === 'uuid') continue;

					if (!(row[rowFieldName] instanceof Array)) {
						row[rowFieldName] = [row[rowFieldName]];
					}

					for (let i = 0; row[rowFieldName][i] !== undefined; i++) {
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

			dbCon.query(sql, dbFields, err => {
				if (err) {
					try {
						this.log.error(logPrefix + 'db err: ' + err.message);
						this.log.error(logPrefix + 'Full order params: ' + JSON.stringify(params));
					} catch (err) {
						this.log.error(logPrefix + 'Could not log proder params: ' + err.message);
					}
				}

				cb(err);
			});
		});

		// Unlock tables
		tasks.push(cb => {
			dbCon.query('UNLOCK TABLES', cb);
		});

		async.series(tasks, err => {
			if (dbCon) {
				dbCon.release();
			}
			emitter.emit(msgUuid, err);

			return cb(err);
		});
	};

	writeOrderField(params, deliveryTag, msgUuid) {
		const uuid = params.uuid;
		const name = params.name;

		this.db.query('INSERT IGNORE INTO orders_orderFields (uuid, name) VALUES(?,?)', [uuid, name], err => {
			if (err) {
				emitter.emit(msgUuid, err);

				return;
			}

			this.helpers.loadOrderFieldsToCache(err => {
				emitter.emit(msgUuid, err);
			});
		});
	};

	writeRowField(params, deliveryTag, msgUuid) {
		const uuid = params.uuid;
		const name = params.name;

		this.db.query('INSERT IGNORE INTO orders_rowFields (uuid, name) VALUES(?,?)', [uuid, name], err => {
			if (err) {
				emitter.emit(msgUuid, err);

				return;
			}

			this.helpers.loadRowFieldsToCache(err => {
				emitter.emit(msgUuid, err);
			});
		});
	}
}

module.exports = exports = DataWriter;
