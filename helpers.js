'use strict';

const topLogPrefix = 'larvitorder: helpers.js: ';
const uuidLib = require('uuid');
const async = require('async');

let orderFields = [];
let rowFields = [];

class Helpers {
	static get orderFields() { return orderFields; }

	static get rowFields() { return rowFields; }

	constructor(options) {
		for (const ro of ['db', 'log', 'dataWriter']) {
			if (!options[ro]) throw new Error('Missing required option "' + ro + '"');
		}

		for (const key of Object.keys(options)) {
			this[key] = options[key];
		}
	}

	getFieldValues(fieldName, cb) {
		const tasks = [];
		const names = [];

		tasks.push(cb => {
			this.dataWriter.ready(cb);
		});

		tasks.push(cb => {
			let sql = 'SELECT DISTINCT fieldValue\n';

			sql += 'FROM orders_orders_fields\n';
			sql += 'WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?)\n';
			sql += 'ORDER BY fieldValue;';

			this.db.query(sql, [fieldName], (err, rows) => {
				if (err) return cb(err);

				for (let i = 0; rows[i] !== undefined; i++) {
					names.push(rows[i].fieldValue);
				}

				cb(null, names);
			});
		});

		async.series(tasks, err => {
			cb(err, names);
		});
	}

	getOrderFieldUuid(fieldName, cb) {
		const tasks = [];

		for (let i = 0; orderFields[i] !== undefined; i++) {
			if (orderFields[i].name === fieldName) {
				cb(null, orderFields[i].uuid);

				return;
			}
		}

		// If we get down here, the field does not exist, create it and rerun

		tasks.push(cb => {
			this.dataWriter.ready(cb);
		});

		tasks.push(cb => {
			const options = {exchange: this.dataWriter.exchangeName};
			const message = {};

			message.action = 'writeOrderField';
			message.params = {};

			message.params.uuid = uuidLib.v1();
			message.params.name = fieldName;

			this.dataWriter.intercom.send(message, options, (err, msgUuid) => {
				if (err) return cb(err);
				this.dataWriter.constructor.emitter.once(msgUuid, err => {
					if (err) return cb(err);

					this.loadOrderFieldsToCache(cb);
				});
			});
		});

		async.series(tasks, err => {
			if (err) return cb(err);

			this.getOrderFieldUuid(fieldName, cb);
		});
	};

	getOrderFieldUuids(fieldNames, cb) {
		const fieldUuidsByName = {};
		const tasks = [];

		for (let i = 0; fieldNames[i] !== undefined; i++) {
			const fieldName = fieldNames[i];

			tasks.push(cb => {
				this.getOrderFieldUuid(fieldName, function (err, fieldUuid) {
					if (err) return cb(err);

					fieldUuidsByName[fieldName] = fieldUuid;
					cb();
				});
			});
		}

		async.parallel(tasks, err => {
			if (err) return cb(err);

			cb(null, fieldUuidsByName);
		});
	};

	getRowFieldUuid(rowFieldName, cb) {
		const logPrefix = topLogPrefix + 'getRowFieldUuid() - ';
		const tasks = [];

		if (rowFieldName === 'uuid') {
			const err = new Error('Row field "uuid" is reserved and have no uuid');

			log.warn(logPrefix + '' + err.message);

			return cb(err);
		}

		for (let i = 0; rowFields[i] !== undefined; i++) {
			if (rowFields[i].name === rowFieldName) {
				return cb(null, rowFields[i].uuid);
			}
		}

		// If we get down here, the field does not exist, create it and rerun

		tasks.push(cb => {
			this.dataWriter.ready(cb);
		});

		tasks.push(cb => {
			const options = {exchange: this.dataWriter.exchangeName};
			const message = {};

			message.action = 'writeRowField';
			message.params = {};

			message.params.uuid = uuidLib.v1();
			message.params.name = rowFieldName;

			this.dataWriter.intercom.send(message, options, (err, msgUuid) => {
				if (err) return cb(err);
				this.dataWriter.constructor.emitter.once(msgUuid, err => {
					if (err) return cb(err);

					this.loadRowFieldsToCache(cb);
				});
			});
		});

		async.series(tasks, err => {
			if (err) return cb(err);

			this.getRowFieldUuid(rowFieldName, cb);
		});
	};

	getRowFieldUuids(rowFieldNames, cb) {
		const rowFieldUuidsByName = {};
		const tasks = [];

		for (let i = 0; rowFieldNames[i] !== undefined; i++) {
			const rowFieldName = rowFieldNames[i];

			if (rowFieldName === 'uuid') continue; // Ignore uuid

			tasks.push(cb => {
				this.getRowFieldUuid(rowFieldName, (err, fieldUuid) => {
					if (err) return cb(err);

					rowFieldUuidsByName[rowFieldName] = fieldUuid;
					cb();
				});
			});
		}

		async.parallel(tasks, err => {
			if (err) return cb(err);

			cb(null, rowFieldUuidsByName);
		});
	};

	loadOrderFieldsToCache(cb) {
		this.db.query('SELECT * FROM orders_orderFields ORDER BY name;', (err, rows) => {
			if (err) return;

			// Empty the previous cache
			orderFields.length = 0;

			// Load the new values
			for (let i = 0; rows[i] !== undefined; i++) {
				orderFields.push(rows[i]);
			}

			cb();
		});
	};

	loadRowFieldsToCache(cb) {
		this.db.query('SELECT * FROM orders_rowFields ORDER BY name;', (err, rows) => {
			if (err) return;

			// Empty the previous cache
			rowFields.length = 0;

			// Load the new values
			for (let i = 0; rows[i] !== undefined; i++) {
				rowFields.push(rows[i]);
			}

			cb();
		});
	}
}

module.exports = exports = Helpers;
