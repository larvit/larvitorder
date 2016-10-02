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
			"uuid": "string",
			"fields": {
				"field1": [394],
				"field2": ["nisse", 20]
			}
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
const	orderLib	= require('larvitorder');

let order = new orderLib.Order({
	'fields': {
		'firstname': 'Günter',
		'lastname': ['Edelweiss', 'Schloffs']
	},
	'rows': [
		{
			'fields': {
				'price': 120,
				'name': 'Screw'
			}
		}
	]
});

order.save(function(err) {
	if (err) throw err;
});
```
