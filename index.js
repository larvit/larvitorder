'use strict';

const	intercom	= require('larvitutils').instances.intercom,
	log	= require('winston');

// We are strictly in need of the intercom!
if ( ! (intercom instanceof require('larvitamintercom'))) {
	const	err	= new Error('larvitutils.instances.intercom is not an instance of Intercom!');
	log.error('larvituser: index.js - ' + err.message);
	throw err;
}

String.prototype.replaceAll = function(search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

exports.Order	= require('./order.js');
exports.Orders	= require('./orders.js');
