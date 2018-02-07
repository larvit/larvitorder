'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	topLogPrefix	= 'larvitorder: order.js: ',
	dataWriter	= require(__dirname + '/dataWriter.js'),
	helpers	= require(__dirname + '/helpers.js'),
	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

let	readyInProgress	= false,
	isReady	= false;

function ready(cb) {
	const	tasks	= [];

	if (isReady === true) return cb();

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	readyInProgress = true;

	tasks.push(function (cb) {
		dataWriter.ready(cb);
	});

	// Load order fields
	tasks.push(helpers.loadOrderFieldsToCache);

	// Load row fields
	tasks.push(helpers.loadRowFieldsToCache);

	async.series(tasks, function () {
		isReady	= true;
		eventEmitter.emit('ready');
		cb();
	});
}

function Order(options) {
	return this.init(options);
}

Order.prototype.init = function (options) {
	const	logPrefix	= topLogPrefix + 'Order.prototype.init() - ';

	if (options === undefined) {
		options = {};
	}

	// If options is a string, assume it is an uuid
	if (typeof options === 'string') {
		options = {'uuid': options};
	}

	if (options.uuid === undefined) {
		options.uuid	= uuidLib.v1();
		log.verbose(logPrefix + 'New Order - Creating Order with uuid: ' + options.uuid);
	} else {
		log.verbose(logPrefix + 'Instanciating order with uuid: ' + options.uuid);
	}

	this.uuid	= options.uuid;

	if (options.created !== undefined) {
		this.created	= options.created;
	} else {
		this.created	= new Date();
	}

	if ( ! (this.created instanceof Date)) {
		throw new Error('created is not an instance of Date');
	}

	this.fields	= options.fields;
	this.ready	= ready; // To expose to the outside world
	this.rows	= options.rows;

	if (this.fields === undefined) {
		this.fields = {};
	}

	if (this.rows === undefined) {
		this.rows = [];
	}

	for (let i = 0; this.rows[i] !== undefined; i ++) {
		if (this.rows[i].uuid === undefined) {
			this.rows[i].uuid = uuidLib.v1();
		}
	}
};

Order.prototype.loadFromDb = function (cb) {
	const	logPrefix	= topLogPrefix + 'Order.prototype.loadFromDb() - uuid: "' + this.uuid + '" - ',
		tasks	= [],
		that	= this,
		uuidBuffer	= lUtils.uuidToBuffer(that.uuid);

	if (uuidBuffer === false) {
		const e = new Error('Invalid order uuid');
		log.warn(logPrefix + e.message);
		return cb(e);
	}

	tasks.push(ready);

	// Get basic order data
	tasks.push(function (cb) {
		log.debug(logPrefix + 'Getting basic order data');
		db.query('SELECT * FROM orders WHERE uuid = ?', [uuidBuffer], function (err, rows) {
			if (err) return cb(err);

			if (rows.length) {
				that.uuid	= lUtils.formatUuid(rows[0].uuid);
				that.created	= rows[0].created;
			}
			cb();
		});
	});

	// Get fields
	tasks.push(function (cb) {
		that.getOrderFields(function (err, fields) {
			that.fields = fields;
			cb();
		});
	});

	// Get rows
	tasks.push(function (cb) {
		that.getOrderRows(function (err, rows) {
			that.rows = rows;
			cb();
		});
	});

	async.series(tasks, cb);
};

Order.prototype.getOrderFields = function (cb) {
	const	fields	= {},
		that	= this,
		uuidBuffer	= lUtils.uuidToBuffer(that.uuid);

	if (uuidBuffer === false) {
		const e = new Error('Invalid order uuid');
		log.warn(topLogPrefix + 'getOrderFields() - ' + e.message);
		return cb(e);
	}

	let sql = '';
	sql += 'SELECT orders_orderFields.name AS name, orders_orders_fields.fieldValue AS value\n';
	sql += 'FROM orders_orders_fields\n';
	sql += '	INNER JOIN orders_orderFields\n';
	sql += '		ON orders_orders_fields.fieldUuid = orders_orderFields.uuid\n';
	sql += 'WHERE orders_orders_fields.orderUuid = ?';

	ready(function () {
		db.query(sql, [uuidBuffer], function (err, data) {
			if (err) return cb(err);

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

Order.prototype.getOrderRows = function (cb) {
	const	sorter	= [],
		rows	= [],
		that	= this,
		uuidBuffer	= lUtils.uuidToBuffer(that.uuid);

	if (uuidBuffer === false) {
		const e = new Error('Invalid order uuid');
		log.warn(topLogPrefix + 'getOrderFields() - ' + e.message);
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

	ready(function () {
		db.query(sql, [uuidBuffer], function (err, data) {
			if (err) return cb(err);

			for (let i = 0; data.length > i; i ++) {
				let value;

				data[i].uuid = lUtils.formatUuid(data[i].uuid);

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

Order.prototype.getOrderFieldUuid	= helpers.getOrderFieldUuid;
Order.prototype.getOrderFieldUuids	= helpers.getOrderFieldUuids;
Order.prototype.getRowFieldUuid	= helpers.getRowFieldUuid;
Order.prototype.getRowFieldUuids	= helpers.getRowFieldUuids;

Order.prototype.rm = function (cb) {
	const	options	= {'exchange': dataWriter.exchangeName},
		message	= {},
		that	= this;

	message.action	= 'rmOrder';
	message.params	= {};

	message.params.uuid	= that.uuid;

	dataWriter.intercom.send(message, options, function (err, msgUuid) {
		if (err) return cb(err);
		dataWriter.emitter.once(msgUuid, cb);
	});
};

// Saving the order object to the database.
Order.prototype.save = function (cb) {
	const	tasks	= [],
		that	= this;

	// Await database readiness
	tasks.push(ready);

	tasks.push(function (cb) {
		const	options	= {'exchange': dataWriter.exchangeName},
			message	= {};

		message.action	= 'writeOrder';
		message.params	= {};

		message.params.uuid	= that.uuid;
		message.params.created	= that.created;
		message.params.fields	= that.fields;
		message.params.rows	= that.rows;

		dataWriter.intercom.send(message, options, function (err, msgUuid) {
			if (err) return cb(err);
			dataWriter.emitter.once(msgUuid, cb);
		});
	});

	tasks.push(function (cb) {
		that.loadFromDb(cb);
	});

	async.series(tasks, cb);
};

exports = module.exports = Order;
