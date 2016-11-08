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

### Add a new order

```javascript
const	orderLib	= require('larvitorder'),
	order	= new orderLib.Order();

order.fields	= {'firstname': 'Günter', 'lastname': ['Edelweiss', 'Schloffs']};
order.rows	= [{'price': 399, 'name': 'Screw'}, {'price': 34, 'name': 'teh_foo', 'tags': ['foo', 'bar']}];

order.save(function(err) {
	if (err) throw err;
});
```
