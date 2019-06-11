'use strict';

const DbMigration = require('larvitdbmigration');
const Helpers = require('./helpers.js');
const LUtils = require('larvitutils');
const Order = require('./order.js');
const Orders = require('./orders.js');

const topLogPrefix = 'larvitorder: index.js: ';
class OrderLib {

	/**
	 * OrderLib constructor
	 * @param {object} options - OrderLib options
	 * @param {object} options.db - Database instance
	 * @param {object} [options.log] - Logging instance
	 */
	constructor(options) {
		if (!options.log) {
			const tmpLUtils = new LUtils();

			options.log = new tmpLUtils.Log();
		}

		this.db = options.db;
		this.log = options.log;

		if (!this.db) {
			const err = new Error('Required option db is missing');

			this.log.error(topLogPrefix + err.message);

			throw err;
		}

		this.helpers = new Helpers({
			log: this.log,
			db: this.db
		});
	}

	runDbMigrations(cb) {
		const options = {};

		options.dbType = 'mariadb';
		options.dbDriver = this.db;
		options.log = this.log;
		options.tableName = 'orders_db_version';
		options.migrationScriptsPath = __dirname + '/dbmigration';

		const dbMigration = new DbMigration(options);

		dbMigration.run(err => {
			if (err) {
				this.log.error(logPrefix + 'Database error: ' + err.message);

				return cb(err);
			}

			cb();
		});
	}

	/**
	 * Create order
	 *
	 * @param {object} options - All options
	 * @param {object} [options.uuid] - UUID of order
	 * @param {object} [options.db] - Database instance, will use default from library if not provided
	 * @param {object} [options.log] - Logging instance, will use default from library if not provided
	 * @param {function} cb - Callback when all initialization is done
	 * @returns {object} - The created order
	 */
	createOrder(options, cb) {
		options = options || {};
		options.db = options.db || this.db;
		options.log = options.log || this.log;

		return new Order(options, cb);
	}
}

exports.OrderLib = OrderLib;
exports.Helpers = Helpers;
exports.Order = Order;
exports.Orders = Orders;
