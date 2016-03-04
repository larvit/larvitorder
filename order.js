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
      i++;
    }
  }

  // Gets all order fields.
  getOrderFields(cb) {
    var order = this;
    log.info('OrderModel: getOrderFields() - Getting existing order fields');
    db.query('SELECT * FROM orders_orderFields', function(err, fields) {
      let result = new Set();
      let i = 0;
      while(fields[i] !== undefined) {
        result.add(fields[i].name);
        i++;
      }
      cb(err, result);
    });
  }

  // Adds order field to the order object.
  addOrderField(key, value) {
    this[key] = value;
  }

  // Creates order fields if not already exists in the "orders_orderFields" table.
  createOrderField(fieldname, fieldvalue, cb) {
    var order = this;
    log.info('OrderModel: createOrderField() - Creating order field: ' + fieldname);
    db.query('INSERT IGNORE INTO orders_orderFields (name) VALUE(?)', [fieldname], function(err, data) {
      if (err) {
        throw err;
      } else {
        order.insertOrderFieldValue(fieldname, fieldvalue);
        cb(data);
      }
    });
  }

  // Inserts order field values to the "orders_orders_fields" table.
  insertOrderFieldValue(fieldname, fieldvalue) {
    var order = this;
    db.query('SELECT * FROM orders_orderFields WHERE name = ?', [fieldname], function(err, result) {
      log.info('OrderModel: insertOrderFieldValue() - Writing order field value: ' + fieldname + ' => ' + fieldvalue);
      db.query('INSERT INTO orders_orders_fields (orderUuid, fieldId, fieldValue) VALUE(?, ?, ?)', [order.uuid, result[0].id, fieldvalue], function(err, data) {
        if (err) {
          throw err;
        }
      });
    });
  }

  // Creates row fields if not already exists in the "orders_rowFields" table.
  createRowField(fieldname, fieldvalue, cb) {
    var order = this;
    log.info('OrderModel: createRowField() - Creating row field: ' + fieldname);
    db.query('INSERT IGNORE INTO orders_rowFields (name) VALUE(?)', [fieldname], function(err, data) {
      if (err) {
        throw err;
      } else {
        order.insertRowFieldValue(fieldname, fieldvalue);
        cb(data);
      }
    });
  }

  // Inserts row field values to the "orders_rows_fields" table.
  insertRowFieldValue(fieldname, fieldvalue) {
    var order = this;
    db.query('SELECT * FROM orders_rowFields WHERE name = ?', [fieldname], function(err, result) {
      log.info('OrderModel: insertRowFieldValue() - Writing row field value: ' + fieldname + ' => ' + fieldvalue);
      db.query('INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUE(?, ?, ?)', [order.uuid, result[0].id, null, fieldvalue], function(err, data) {
        if (err) {
          throw err;
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

  // Saving the order object to the database.
  save(cb) {
    var order = this,
        tasks = new Array();

    tasks.push(function(cb) {
      order.insertOrder(function(result) {
        cb(null, result);
      });
    });

    tasks.push(function(cb) {
      order.getOrderFields(function(err, fields) {
        var subtasks = new Array();
        
        var createSubtask = function(key, value) {
          subtasks.push(function(cb) {
            order.createOrderField(key, value, function(result) {
              cb(null, result);
            });
          });
        };

        for (var key in order) {
          if (
            key !== 'uuid' &&
            key !== 'rows' &&
            key !== 'created'
          ) {
            createSubtask(key, order[key]);
          }
        }

        async.series(subtasks, function(err, result) {
          cb(result);
        });

      });
    });

    async.series(tasks, function(err,result) {
      console.log(result);
    });
  }
}

exports = module.exports = Order;
