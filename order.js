'use strict';

var uuid  = require('node-uuid'),
    log   = require('winston'),
    db    = require('larvitdb'),
    async = require('async');

class Order {
  constructor(rows) {
    this.uuid = uuid.v4();
    this.created = new Date();
    this.rows = rows;

    log.info('OrderModel: New Order - Creating Order with uuid: ' + this.uuid);
    let i = 0;
    while(this.rows[i] !== undefined) {
      this.rows[i].set('uuid', uuid.v4());
      i ++;
    }
  }

  // Adds order field to the order object.
  addOrderField(key, value) {
    this[key] = value;
  }

  // Creates order fields if not already exists in the "orders_orderFields" table.
  createOrderField(fieldname, fieldvalue, cb) {
    var order = this;
    log.info('OrderModel: createOrderField() - Creating order field: ' + fieldname);
    db.query('INSERT IGNORE INTO orders_orderFields (name) VALUE(?)', [fieldname], function(err) {
      if (err) {
        throw err;
      } else {
        order.insertOrderFieldValue(fieldname, fieldvalue, function(err, result) {
          cb(null, result);
        });
      }
    });
  }

  // Inserts order field values to the "orders_orders_fields" table.
  insertOrderFieldValue(fieldname, fieldvalue, cb) {
    var order = this;
    db.query('SELECT * FROM orders_orderFields WHERE name = ?', [fieldname], function(err, result) {
      log.info('OrderModel: insertOrderFieldValue() - Writing order field value: ' + fieldname + ' => ' + fieldvalue);
      db.query('INSERT INTO orders_orders_fields (orderUuid, fieldId, fieldValue) VALUE(?, ?, ?)', [order.uuid, result[0].id, fieldvalue], function(err, result) {
        if (err) {
          throw err;
        } else {
          cb(null, result);
        }
      });
    });
  }


  // Creates the order i the "orders" table.
  insertOrder(cb) {
    var order = this;

    log.info('OrderModel: insertOrder() - Writing order: ' + order.uuid);
    db.query('INSERT INTO orders (uuid, created) VALUE(?, ?)', [order.uuid, order.created], function(err, data) {
      if (err) {
        throw err;
      }
      cb(data);
    });
  }


  // Creates a row i the "orders_rows" table.
  insertRow(row, cb) {
    var order = this;
    row.set('uuid', uuid.v4());

    log.info('OrderModel: insertRow() - Writing row: ' + row.uuid);
    db.query('INSERT INTO orders_rows (rowUuid, orderUuid) VALUE(?, ?)', [row.get('uuid'), order.uuid], function(err, data) {
      if (err) {
        throw err;
      }
      cb(data);
    });
  }


  // Creates order fields if not already exists in the "orders_orderFields" table.
  createRowField(fieldname, fieldvalue, cb) {
    log.info('OrderModel: createRowField() - Creating row field: ' + fieldname);
    db.query('INSERT IGNORE INTO orders_rowFields (name) VALUE(?)', [fieldname], function(err, data) {
      if (err) {
        throw err;
      } else {
        cb(data);
      }
    });
  }

  // Inserts order field values to the "orders_orders_fields" table.
  insertRowFieldValue(rowuuid, fieldname, fieldvalue, cb) {
    var rowIntValue,
        rowStrValue;

    if (fieldvalue === parseInt(fieldvalue)) {
      rowIntValue = fieldvalue;
      rowStrValue = null;
    } else {
      rowIntValue = null;
      rowStrValue = fieldvalue;
    }

    db.query('SELECT * FROM orders_rowFields WHERE name = ?', [fieldname], function(err, field) {
      log.info('OrderModel: insertRowFieldValue() - Writing row field value: ' + fieldname + ' => ' + fieldvalue);
      db.query('INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUE(?, ?, ?, ?)', [rowuuid, field[0].id, rowIntValue, rowStrValue], function(err, result) {
        if (err) {
          throw err;
        } else  {
          cb(null, result);
        }
      });
    });
  }


  // Saving the order object to the database.
  save(cb) {
    var order = this,
        tasks = new Array(),
        key;

    // Insert order
    tasks.push(function(cb) {
      order.insertOrder(function(result) {
        cb(null, result);
      });
    });

    // Insert order fields and fieldvalues
    tasks.push(function(cb) {
        var subtasks = new Array(),
            createSubtask;
        
        createSubtask = function(key, value) {
          subtasks.push(function(cb) {
            order.createOrderField(key, value, function(result) {
              cb(null, result);
            });
          });
        };

        for (key in order) {
          if (
            key !== 'uuid' &&
            key !== 'rows' &&
            key !== 'created'
          ) {
            createSubtask(key, order[key]);
          }
        }

        async.series(subtasks, function(err, result) {
          cb(null, result);
        });
    });

    // Insert rows 
    tasks.push(function(cb) {
      order.insertRow(order.rows[0], function(result) {
        cb(null, result);
      });
    });

    // Insert order fields and fieldvalues
    tasks.push(function(cb) {
        var subtasks = new Array(),
            createFields,
            insertFieldValues;
        
        createFields = function(fieldname, fieldvalue) {
          subtasks.push(function(cb) {
            order.createRowField(fieldname, fieldvalue, function(result) {
              cb(null, result);
            });
          });
        };

        insertFieldValues = function(rowuuid, fieldname, fieldvalue) {
          subtasks.push(function(cb) {
            order.insertRowFieldValue(rowuuid, fieldname, fieldvalue, function(err, result) {
              cb(null, result);
            });
          });
        };

        order.rows.forEach(function (row) {
          row.forEach(function(fieldvalue, fieldname) {
            createFields(fieldname, fieldvalue);
            insertFieldValues(row.get('uuid'), fieldname, fieldvalue);
          });
        });

        async.series(subtasks, function(err, result) {
          cb(null, result);
        });
    });

    async.series(tasks, function(err, result) {
      cb(null, result);
    });

  }
}

exports = module.exports = Order;
