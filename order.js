/* eslint-disable no-tabs */
'use strict';

const Intercom = require('larvitamintercom');
const topLogPrefix = 'larvitorder: order.js: ';
const DataWriter = require(__dirname + '/dataWriter.js');
const Helpers = require(__dirname + '/helpers.js');
const uuidLib = require('uuid');
const LUtils = require('larvitutils');
const async = require('async');

function Order(options) {
	const logPrefix = topLogPrefix + 'Order() - ';

	this.options = options || {};

	if (!options.log) {
		const tmpLUtils = new LUtils();

		options.log = new tmpLUtils.Log();
	}

	this.options = options;

	for (const key of Object.keys(options)) {
		this[key] = options[key];
	}

	this.lUtils = new LUtils({log: this.log});

	if (!this.db) {
		const err = new Error('Required option db is missing');

		this.log.error(logPrefix + err.message);
		throw err;
	}

	if (!this.exchangeName) {
		this.exchangeName = 'larvitorder';
	}

	if (!this.mode) {
		this.log.info(logPrefix + 'No "mode" option given, defaulting to "noSync"');
		this.mode = 'noSync';
	} else if (['noSync', 'master', 'slave'].indexOf(this.mode) === -1) {
		const err = new Error('Invalid "mode" option given: "' + this.mode + '"');

		this.log.error(logPrefix + err.message);
		throw err;
	}

	if (!this.intercom) {
		this.log.info(logPrefix + 'No "intercom" option given, defaulting to "loopback interface"');
		this.intercom = new Intercom('loopback interface');
	}

	this.init(options);

	this.dataWriter = new DataWriter({
		exchangeName: this.exchangeName,
		intercom: this.intercom,
		mode: this.mode,
		log: this.log,
		db: this.db,
		amsync_host: this.options.amsync_host || null,
		amsync_minPort: this.options.amsync_minPort || null,
		amsync_maxPort: this.options.amsync_maxPort || null
	}, err => {
		if (err) this.log.error(logPrefix + 'Failed to initialize dataWriter: ' + err.message);
	});

	this.dataWriter.ready(() => {
		const tasks = [];

		tasks.push(cb => {
			this.helpers = new Helpers({
				log: this.log,
				db: this.db,
				dataWriter: this.dataWriter
			});

			this.loadOrderFieldsToCache = this.helpers.loadOrderFieldsToCache;
			this.loadRowFieldsToCache = this.helpers.loadRowFieldsToCache;

			cb();
		});

		// Load order fields
		tasks.push(cb => this.loadOrderFieldsToCache(cb));

		// Load row fields
		tasks.push(cb => this.loadRowFieldsToCache(cb));

		async.series(tasks, err => {
			if (err) this.log.error(logPrefix + err.message);
		});
	});
}

Order.prototype.ready = function (cb) {
	this.dataWriter.ready(cb);
};

Order.prototype.init = function (options) {
	const logPrefix = topLogPrefix + 'Order.prototype.init() - ';

	if (options === undefined) {
		options = {};
	}

	// If options is a string, assume it is an uuid
	if (typeof options === 'string') {
		options = {uuid: options};
	}

	if (options.uuid === undefined) {
		options.uuid = uuidLib.v1();
		this.log.debug(logPrefix + 'New Order - Creating Order with uuid: ' + options.uuid);
	} else {
		this.log.debug(logPrefix + 'Instanciating order with uuid: ' + options.uuid);
	}

	this.uuid = options.uuid;

	if (options.created !== undefined) {
		this.created = options.created;
	} else {
		this.created = new Date();
	}

	if (!(this.created instanceof Date)) {
		throw new Error('created is not an instance of Date');
	}

	this.fields = options.fields;
	this.rows = options.rows;

	if (this.fields === undefined) {
		this.fields = {};
	}

	if (this.rows === undefined) {
		this.rows = [];
	}

	for (let i = 0; this.rows[i] !== undefined; i++) {
		if (this.rows[i].uuid === undefined) {
			this.rows[i].uuid = uuidLib.v1();
		}
	}
};

Order.prototype.loadFromDb = function (cb) {
	const logPrefix = topLogPrefix + 'Order.prototype.loadFromDb() - uuid: "' + this.uuid + '" - ';
	const tasks = [];
	const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);

	if (uuidBuffer === false) {
		const err = new Error('Invalid order uuid');

		this.log.warn(logPrefix + err.message);

		return cb(err);
	}

	tasks.push(cb => {
		this.dataWriter.ready(cb);
	});

	// Get basic order data
	tasks.push(cb => {
		this.log.debug(logPrefix + 'Getting basic order data');
		this.db.query('SELECT * FROM orders WHERE uuid = ?', [uuidBuffer], (err, rows) => {
			if (err) return cb(err);

			if (rows.length) {
				this.uuid = this.lUtils.formatUuid(rows[0].uuid);
				this.created = rows[0].created;
			}
			cb();
		});
	});

	// Get fields
	tasks.push(cb => {
		this.getOrderFields((err, fields) => {
			this.fields = fields;
			cb(err);
		});
	});

	// Get rows
	tasks.push(cb => {
		this.getOrderRows((err, rows) => {
			this.rows = rows;
			cb(err);
		});
	});

	// Sort rows
	tasks.push(cb => {
		this.sortRows();
		cb();
	});

	async.series(tasks, cb);
};

Order.prototype.getOrderFields = function (cb) {
	const tasks = [];
	const fields = {};

	tasks.push(cb => {
		this.dataWriter.ready(cb);
	});

	tasks.push(cb => {
		const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);

		if (uuidBuffer === false) {
			const e = new Error('Invalid order uuid');

			this.log.warn(topLogPrefix + 'getOrderFields() - ' + e.message);

			return cb(e);
		}

		let sql = '';

		sql += 'SELECT orders_orderFields.name AS name, orders_orders_fields.fieldValue AS value\n';
		sql += 'FROM orders_orders_fields\n';
		sql += '	INNER JOIN orders_orderFields\n';
		sql += '		ON orders_orders_fields.fieldUuid = orders_orderFields.uuid\n';
		sql += 'WHERE orders_orders_fields.orderUuid = ?';


		this.db.query(sql, [uuidBuffer], (err, data) => {
			if (err) return cb(err);

			for (let i = 0; data.length > i; i++) {
				if (fields[data[i].name] !== undefined) {
					fields[data[i].name].push(data[i].value);
				} else {
					fields[data[i].name] = [data[i].value];
				}
			}
			cb(null);
		});
	});

	async.series(tasks, err => {
		cb(err, fields);
	});
};

Order.prototype.getOrderRows = function (cb) {
	const tasks = [];
	const rows = [];

	tasks.push(cb => { this.dataWriter.ready(cb); });

	tasks.push(cb => {
		const sorter = [];
		const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);

		if (uuidBuffer === false) {
			const e = new Error('Invalid order uuid');

			this.log.warn(topLogPrefix + 'getOrderFields() - ' + e.message);

			return cb(e);
		}

		let sql = '';

		sql += 'SELECT orders_rows.rowUuid AS uuid, orders_rows_fields.rowStrValue, orders_rows_fields.rowIntValue, orders_rowFields.name\n';
		sql += 'FROM orders_rows\n';
		sql += '	INNER JOIN orders_rows_fields\n';
		sql += '		ON orders_rows_fields.rowUuid = orders_rows.rowUuid\n';
		sql += '	INNER JOIN orders_rowFields\n';
		sql += '		ON orders_rowFields.uuid = orders_rows_fields.rowFieldUuid\n';
		sql += 'WHERE orders_rows.orderUuid = ?';

		this.db.query(sql, [uuidBuffer], (err, data) => {
			if (err) return cb(err);

			for (let i = 0; data.length > i; i++) {
				let value;

				data[i].uuid = this.lUtils.formatUuid(data[i].uuid);

				if (sorter[data[i].uuid] === undefined) {
					sorter[data[i].uuid] = {
						uuid: data[i].uuid
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

				if (!(sorter[data[i].uuid][data[i].name] instanceof Array)) {
					sorter[data[i].uuid][data[i].name] = [sorter[data[i].uuid][data[i].name]];
				}

				sorter[data[i].uuid][data[i].name].push(value);
			}

			for (let key in sorter) {
				rows.push(sorter[key]);
			}

			cb(null);
		});
	});

	async.series(tasks, err => {
		cb(err, rows);
	});
};

Order.prototype.rm = function (cb) {
	this.ready(() => {
		const options = {exchange: this.dataWriter.exchangeName};
		const message = {};

		message.action = 'rmOrder';
		message.params = {};

		message.params.uuid = this.uuid;

		this.dataWriter.intercom.send(message, options, (err, msgUuid) => {
			if (err) return cb(err);
			this.dataWriter.emitter.once(msgUuid, cb);
		});
	});
};

// Saving the order object to the database.
Order.prototype.save = function (cb) {
	const tasks = [];

	tasks.push(cb => { this.dataWriter.ready(cb); });

	tasks.push(cb => {
		const options = {exchange: this.dataWriter.exchangeName};
		const message = {};

		message.action = 'writeOrder';
		message.params = {};

		message.params.uuid = this.uuid;
		message.params.created = this.created;
		message.params.fields = this.fields;
		message.params.rows = this.rows;

		// Set sortOrder on rows to maintain order independent of storage engine
		for (let i = 0; message.params.rows[i] !== undefined; i++) {
			message.params.rows[i].sortOrder = i;
		}

		this.dataWriter.intercom.send(message, options, (err, msgUuid) => {
			if (err) return cb(err);
			this.dataWriter.emitter.once(msgUuid, cb);
		});
	});

	tasks.push(cb => {
		this.loadFromDb(cb);
	});

	async.series(tasks, cb);
};

// Sorting rows on the row field "sortOrder" if it exists
Order.prototype.sortRows = function sortRows() {
	if (!this.rows || this.rows.length === 0) return;

	this.rows.sort(function (a, b) {
		const ax = Number(Array.isArray(a.sortOrder) ? a.sortOrder[0] : a.sortOrder);
		const bx = Number(Array.isArray(b.sortOrder) ? b.sortOrder[0] : b.sortOrder);

		if (ax === bx) return 0;

		if (isNaN(ax) && !isNaN(bx)) return 1;
		if (isNaN(bx) && !isNaN(ax)) return -1;

		return ax - bx;
	});

	// Remove all sortOrder fields
	for (let i = 0; this.rows[i] !== undefined; i++) {
		delete this.rows[i].sortOrder;
	}
};

exports = module.exports = Order;
