import { LogInstance } from 'larvitutils';
import { DbMigration } from 'larvitdbmigration';
import { GetFieldValuesOptions, Helpers } from './helpers';
import { Utils, Log } from 'larvitutils';
import { Order, OrderData } from './order';
import { RowOptions } from './row';
import { Orders, OrdersOptions } from './orders';

export { Helpers } from './helpers';
export { Order } from './order';
export { Orders } from './orders';

type OrderLibOptions = {
	db: any,
	log: LogInstance,
};

export class OrderLib {
	db: any;
	log: LogInstance;
	lUtils: Utils;
	helpers: Helpers;

	constructor(options: OrderLibOptions) {
		if (!options.db) throw new Error('Required option "db" is missing');

		this.db = options.db;
		this.log = options.log ?? new Log();
		this.lUtils = new Utils();
		this.helpers = new Helpers({ db: this.db, lUtils: this.lUtils, log: this.log });
	}

	async runDbMigrations(): Promise<void> {
		const dbMigration = new DbMigration({
			dbType: 'mariadb',
			dbDriver: this.db,
			log: this.log,
			tableName: 'orders_db_version',
			migrationScriptPath: __dirname + '/../dbmigration',
		});

		await dbMigration.run();
	}

	async loadOrderFieldsToCache(): Promise<void> {
		await this.helpers.loadOrderFieldsToCache();
		await this.helpers.loadRowFieldsToCache();
	}

	createOrder(options?: Omit<Partial<OrderData>, 'rows'> & { rows?: RowOptions[] }): Order {
		const order = new Order({
			db: this.db,
			log: this.log,
			lUtils: this.lUtils,
			...options,
		});

		return order;
	}

	async loadOrder(uuid: string): Promise<Order | undefined> {
		const order = new Order({
			db: this.db,
			log: this.log,
			lUtils: this.lUtils,
			uuid,
		});

		const loaded = await order.loadFromDb();

		if (!loaded) {
			return undefined;
		}

		return order;
	}

	async getOrders(options: Omit<OrdersOptions, 'db' | 'log' | 'lUtils' | 'helpers'> = {}) : Promise<{ orders: Record<string, OrderData>, hits: number }> {
		const orders = new Orders({
			db: this.db,
			log: this.log,
			lUtils: this.lUtils,
			helpers: this.helpers,
			...options,
		});

		return orders.get();
	}

	async removeOrder(uuid: string): Promise<void> {
		const order = new Order({
			db: this.db,
			log: this.log,
			lUtils: this.lUtils,
			uuid,
		});

		await order.rm();
	}

	async getFieldValues(options: GetFieldValuesOptions): Promise<string[]> {
		return await this.helpers.getFieldValues(options);
	}
}
