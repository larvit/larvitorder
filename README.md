[![Build Status](https://github.com/larvit/larvitorder/actions/workflows/ci.yml/badge.svg)](https://github.com/larvit/larvitorder/actions)

# larvitorder

Generic order module for nodejs.

order data structure:
```json
{
	"uuid": "string",
	"fields": {
		"field1": [
			"value1",
			"value2"
		],
		"field2": [
			"value3"
		]
	},
	"rows": [
		{
			"uuid": "string", <-- special field
			"field1": [394],
			"field2": ["nisse", 20]
		}
	]
}
```

## Installation

```bash
npm i --save larvitorder
```

## Usage

### Initialize

All below instructions require the loading of libraries like something below (db is an instance of larvitdb and log an instance of winston or larvitutils.Log):

```javascript
const OrderLib = require('larvitorder');
const orderLib = new OrderLib({ db, log })
await orderLib.runDbMigrations();
```

### Add a new order

```javascript
const order = new orderLib.Order({db});

order.created = '2022-12-01T13:37:00Z'; // Must be ISO-8601
order.fields	= {'firstname': 'Günter', 'lastname': ['Edelweiss', 'Schloffs']};
order.rows	= [{'price': 399, 'name': 'Screw'}, {'price': 34, 'name': 'teh_foo', 'tags': ['foo', 'bar']}];

await order.save();
```

### Load existing order from database

```javascript
const order = new orderLib.Order({uuid: 'uuid-on-existing-order-in-db', db});

await order.loadFromDb();
// Now order.fields and order.rows is loaded from database
```

### Remove order from database

```javascript
const order = new orderLib.Order({uuid: 'uuid-on-existing-order-in-db', db});

await order.rm();
// order is now removed from DB
```

### Get orders

```javascript
const ordersCtx = new orderLib.Orders({db});

const {orders, hits} = await ordersCtx.get();
```

#### Filter and limit order list

```javascript
const ordersCtx = new orderLib.Orders({db});

// Filter and limit order hits
orders.limit = 10;	// Only return 10 orders
orders.offset = 5;	// Skip the 5 first orders
orders.uuids = ['1ebe346e-c05a-11e6-a4a6-cec0c932ce01'];	// Only return orders with these uuids
orders.matchAllFields = {'firstname': 'Abraham', 'lastname': 'Lincoln'};	// Only return orders that have both the fields firstname and lastname that matches
orders.matchAllRowFields = {'productName': 'A4 paper'};	// Only return orders that have rows matching both the row fieldname "productName" and the value "A4 paper"

// Return order fields
orders.returnFields	= ['firstname', 'lastname', 'status'];	// Only return the order fields listed. IMPORTANT! Will return no order fields if not supplied! Because performance.

// Return order row fields
orders.returnRowFields	= ['productName', 'price'];	// Only return the order row fields listed. IMPORTANT! Will return no order row fields if not supplied! Because performance.

const {orders, hits} = await ordersCtx.get();
```
