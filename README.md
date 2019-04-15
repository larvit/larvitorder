[![Build Status](https://travis-ci.org/larvit/larvitorder.svg?branch=master)](https://travis-ci.org/larvit/larvitorder) [![Dependencies](https://david-dm.org/larvit/larvitorder.svg)](https://david-dm.org/larvit/larvitorder.svg)

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

All below instructions require the loading of libraries like something below:

```javascript
const orderLib = require('larvitorder');
const db = require('larvitdb');

db.setup({options}); // See documentation at https://github.com/larvit/larvitdb
```

### Add a new order

```javascript
const order = new orderLib.Order({db});

order.fields	= {'firstname': 'Günter', 'lastname': ['Edelweiss', 'Schloffs']};
order.rows	= [{'price': 399, 'name': 'Screw'}, {'price': 34, 'name': 'teh_foo', 'tags': ['foo', 'bar']}];

order.save(err => {
	if (err) throw err;
});
```

### Load existing order from database

```javascript
const order = new orderLib.Order({uuid: 'uuid-on-existing-order-in-db', db});

order.loadFromDb(err => {
	if (err) throw err;

	// Now order.fields and order.rows is loaded from database
});
```

### Remove order from database

```javascript
const order = new orderLib.Order({uuid: 'uuid-on-existing-order-in-db', db});

order.rm(err => {
	if (err) throw err;

	// order is now removed from DB
});
```

### Get orders

```javascript
const orders = new orderLib.Orders({db});

orders.get(function (err, orderList) {
	if (err) throw err;

	// orderList is now an array of objects
});
```

#### Filter and limit order list

```javascript
const orders = new orderLib.Orders({db});

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

orders.get((err, orderList) => {
	if (err) throw err;

	// orderList is now an array of objects
});
```
