'use strict';

const DbMigration = require('larvitdbmigration');
const LUtils = require('larvitutils');

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
}

exports.OrderLib = OrderLib;
exports.helpers = require('./helpers.js');
exports.Order = require('./order.js');
exports.Orders = require('./orders.js');
