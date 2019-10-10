'use strict';

const uuidValidate = require('uuid-validate');
const OrderLib = require(__dirname + '/../index.js');
const uuidLib = require('uuid');
const assert = require('assert');
const LUtils = require('larvitutils');
const lUtils = new LUtils();
const async = require('async');
const log = new lUtils.Log('warn');
const db = require('larvitdb');
const fs = require('fs');

let orderLib;

before(function (done) {
	const tasks = [];

	this.timeout(10000);

	// Run DB Setup
	tasks.push(function (cb) {
		let confFile;

		if (process.env.TRAVIS) {
			confFile = __dirname + '/../config/db_travis.json';
		} else if (process.env.DBCONFFILE) {
			confFile = process.env.DBCONFFILE;
		} else {
			confFile = __dirname + '/../config/db_test.json';
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			if (err) {
				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;
					log.verbose('DB config: ' + JSON.stringify(require(confFile)));
					db.setup(require(confFile), cb);
				});

				return;
			}

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));
			db.setup(require(confFile), cb);
		});
	});

	tasks.push(cb => {
		db.removeAllTables(cb);
	});

	// Check for empty db
	tasks.push(function (cb) {
		db.query('SHOW TABLES', function (err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	// Load libs and migration
	tasks.push(function (cb) {
		orderLib = new OrderLib.OrderLib({
			db,
			log
		});

		orderLib.runDbMigrations(cb);
	});

	async.series(tasks, done);
});

describe('Generate data', function () {
	it('should generate 10k test orders', function (done) {
		if (process.env.TRAVIS) { return done(); } // No need to run this on travis

		const tasks = [];

		this.timeout(220000);

		for (let i = 0; i < 10000; i++) {
			tasks.push(function (cb) {
				const order = orderLib.createOrder({
					fields: {},
					rows: []
				});

				for (let j = 0; j < 35; j++) {
					order.fields[`fieldName${j}`] = [uuidLib.v4()];
				}

				for (let j = 0; j < 10; j++) {
					const row = {};

					for (let l = 0; l < 30; l++) {
						row[`rowFieldName${l}`] = [uuidLib.v4()];
					}

					order.rows.push(row);
				}

				order.save(cb);
			});
		}

		async.parallelLimit(tasks, 10, function (err) {
			if (err) throw err;

			const orders = new OrderLib.Orders({log, db});
			orders.limit = 1;

			orders.get(function (err, orderList, orderHits) {
				if (err) throw err;
				assert.strictEqual(orderHits, 10005);

				done();
			});
		});
	});

	it('should update an order within reasonalbe time', function (done) {
		if (process.env.TRAVIS) { return done(); } // No need to run this on travis

		this.timeout(2000);

		const tasks = [];

		let orderUuid;

		tasks.push(function (cb) {
			const orders = new OrderLib.Orders({log, db});
			orders.limit = 1;

			orders.get(function (err, orderList, orderHits) {
				if (err) throw err;
				assert.strictEqual(orderHits, 10005);

				orderUuid = Object.keys(orderList)[0];

				cb();
			});
		});

		tasks.push(function (cb) {
			const order = new OrderLib.Order({uuid: orderUuid, db, log});

			order.loadFromDb(function (err) {
				if (err) throw err;

				assert.strictEqual(toString.call(order), '[object Object]');
				assert.strictEqual(uuidValidate(order.uuid, 1), true);
				assert.strictEqual(order.uuid, orderUuid);
				assert.strictEqual(order.rows.length, 10);

				order.fields.newField1 = ['Some value'];
				order.rows.push({aaaw: ['gooood laaawwwd!']});

				order.save(cb);
			});
		});

		tasks.push(function (cb) {
			const order = new OrderLib.Order({uuid: orderUuid, db, log});

			order.loadFromDb(function (err) {
				if (err) throw err;

				assert.strictEqual(toString.call(order), '[object Object]');
				assert.strictEqual(uuidValidate(order.uuid, 1), true);
				assert.strictEqual(order.uuid, orderUuid);
				assert.deepStrictEqual(order.fields.newField1, ['Some value']);

				const row = order.rows.find(n => n.aaaw);

				assert.notStrictEqual(row, undefined);
				assert.deepStrictEqual(row.aaaw, ['gooood laaawwwd!']);

				cb();
			});
		});

		async.series(tasks, done);
	});

	it('should remove an order in reasonalbe time', function (done) {
		if (process.env.TRAVIS) { return done(); } // No need to run this on travis

		this.timeout(2000);

		const tasks = [];

		let orderUuid;

		tasks.push(function (cb) {
			const orders = new OrderLib.Orders({log, db});
			orders.limit = 1;

			orders.get(function (err, orderList, orderHits) {
				if (err) throw err;
				assert.strictEqual(orderHits, 10005);

				orderUuid = Object.keys(orderList)[0];

				cb();
			});
		});

		tasks.push(function (cb) {
			const order = new OrderLib.Order({uuid: orderUuid, db, log});
			order.rm(cb);
		});

		tasks.push(function (cb) {
			const order = new OrderLib.Order({uuid: orderUuid, db, log});

			order.loadFromDb(function (err) {
				if (err) throw err;

				assert.strictEqual(toString.call(order), '[object Object]');
				cb();
			});
		});

		async.series(tasks, done);
	});
});
