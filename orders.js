'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	dbmigration	= require('larvitdbmigration')({'tableName': 'orders_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	uuidLib	= require('node-uuid'),
	async	= require('async'),
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

	async.series(tasks, function() {
		isReady	= true;
		eventEmitter.emit('ready');
		cb();
	});
}

function Orders() {
	this.ready	= ready;
}

Orders.prototype.get = function(cb) {
	const	tasks	= [],
		that	= this;

	let orders = {};

	// Make sure database is ready
	tasks.push(ready);

	// Get basic orders
	tasks.push(function(cb) {
		const dbFields = [];

		let sql = 'SELECT * FROM orders WHERE 1';

		if (that.uuids !== undefined) {
			if ( ! (that.uuids instanceof Array)) {
				that.uuids = [that.uuids];
			}

			if (that.uuids.length === 0) {
				sql += '	AND 0';
			} else {
				sql += '	AND uuid IN (';

				for (let i = 0; that.uuids[i] !== undefined; i ++) {
					let uuid = that.uuids[i].replaceAll('-', '');
					sql += '?,';
					dbFields.push(new Buffer(uuid, 'hex'));
				}

				sql = sql.substring(0, sql.length - 1) + ')';
			}
		}

		if (that.matchAllFields !== undefined) {
			for (let fieldName in that.matchAllFields) {
				sql += '	AND orders.uuid IN (\n';
				sql += '		SELECT DISTINCT orderUuid\n';
				sql += '		FROM orders_orders_fields\n';
				sql += '		WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue = ?\n';
				sql += ')';

				dbFields.push(fieldName);
				dbFields.push(that.matchAllFields[fieldName]);
			}
		}

		if (that.matchAllRowFields !== undefined) {
			for (let rowFieldName in that.matchAllRowFields) {
				sql += '	AND orders.uuid IN (\n';
				sql += '		SELECT DISTINCT orderUuid\n';
				sql += '		FROM orders_rows\n';
				sql += '		WHERE rowUuid IN (\n';
				sql += '			SELECT rowUuid FROM orders_rows_fields WHERE rowFieldUuid = (SELECT uuid FROM orders_rowFields WHERE name = ?) AND ';

				if (parseInt(that.matchAllRowFields[rowFieldName]) === that.matchAllRowFields[rowFieldName]) {
					sql += 'rowIntValue = ?\n';
				} else {
					sql += 'rowStrValue = ?\n';
				}

				sql += '		)';
				sql += '	)';

				dbFields.push(rowFieldName);
				dbFields.push(that.matchAllRowFields[rowFieldName]);
			}
		}

		sql += '	ORDER BY created DESC';

		if (that.limit) {
			sql += ' LIMIT ' + parseInt(that.limit);
			if (that.offset) {
				sql += ' OFFSET ' + parseInt(that.offset);
			}
		}

		ready(function() {
			db.query(sql, dbFields, function(err, rows) {
				if (err) { cb(err); return; }

				for (let i = 0; rows[i] !== undefined; i ++) {
					rows[i].uuid	= uuidLib.unparse(rows[i].uuid);
					orders[rows[i].uuid]	= {};
					orders[rows[i].uuid].uuid	= rows[i].uuid;
					orders[rows[i].uuid].created	= rows[i].created;
				}

				cb();
			});
		});
	});

	// Get fields
	tasks.push(function(cb) {
		const dbFields = [];

		let sql;

		if ( ! that.returnFields || Object.keys(orders).length === 0) {
			cb();
			return;
		}

		sql =  'SELECT orderUuid, name AS fieldName, fieldValue\n';
		sql += 'FROM orders_orders_fields JOIN orders_orderFields ON fieldUuid = uuid\n';
		sql += 'WHERE\n';
		sql += '	orderUuid IN (';

		for (let orderUuid in orders) {
			sql += '?,';
			dbFields.push(new Buffer(uuidLib.parse(orderUuid)));
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';

		sql += '	AND name IN (';

		for (let i = 0; that.returnFields[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(that.returnFields[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')\n';

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			for (let i = 0; rows[i] !== undefined; i ++) {
				const row = rows[i];

				row.orderUuid = uuidLib.unparse(row.orderUuid);

				if (orders[row.orderUuid].fields === undefined) {
					orders[row.orderUuid].fields = {};
				}

				if (orders[row.orderUuid].fields[row.fieldName] === undefined) {
					orders[row.orderUuid].fields[row.fieldName] = [];
				}

				orders[row.orderUuid].fields[row.fieldName].push(row.fieldValue);
			}

			cb();
		});
	});

	// Get rows
	tasks.push(function(cb) {
		const dbFields = [];

		let sql;

		if (that.returnRowFields === undefined || Object.keys(orders).length === 0) {
			cb();
			return;
		}

		sql  = 'SELECT r.orderUuid, r.rowUuid, f.name AS fieldName, rf.rowIntValue, rf.rowStrValue\n';
		sql += 'FROM orders_rows r\n';
		sql += '	LEFT JOIN orders_rows_fields	rf	ON rf.rowUuid	= r.rowUuid\n';
		sql += '	LEFT JOIN orders_rowFields	f	ON f.uuid	= rf.rowFieldUuid\n';
		sql += 'WHERE r.orderUuid IN (';

		for (let orderUuid in orders) {
			sql += '?,';
			dbFields.push(new Buffer(uuidLib.parse(orderUuid)));
		}

		sql = sql.substring(0, sql.length - 1) + ')';
		sql += '	AND f.name IN (';

		for (let i = 0; that.returnRowFields[i] !== undefined; i ++) {
			sql += '?,';
			dbFields.push(that.returnRowFields[i]);
		}

		sql = sql.substring(0, sql.length - 1) + ')';

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			for (let i = 0; rows[i] !== undefined; i ++) {
				const row = rows[i];

				row.orderUuid	= uuidLib.unparse(row.orderUuid);
				row.rowUuid	= uuidLib.unparse(row.rowUuid);

				if (orders[row.orderUuid].rows === undefined) {
					orders[row.orderUuid].rows = {};
				}

				if (orders[row.orderUuid].rows[row.rowUuid] === undefined) {
					orders[row.orderUuid].rows[row.rowUuid] = {'uuid': row.rowUuid};
				}

				if (orders[row.orderUuid].rows[row.rowUuid][row.fieldName] === undefined) {
					orders[row.orderUuid].rows[row.rowUuid][row.fieldName] = [];
				}

				if (row.rowIntValue !== null) {
					orders[row.orderUuid].rows[row.rowUuid][row.fieldName].push(row.rowIntValue);
				} else if (row.rowStrValue !== null) {
					orders[row.orderUuid].rows[row.rowUuid][row.fieldName].push(row.rowStrValue);
				}
			}

			cb();
		});
	});

	async.series(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(null, orders);
	});

};

exports = module.exports = Orders;
