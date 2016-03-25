// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------
var util = require('util');

function addFactory(target, type) {
    target[type] = function(message) {
        var error = new Error(util.format.apply(null, arguments));
        error[type] = true;
        return error;
    };
    return target;
}

module.exports = ['badRequest', 'concurrency', 'duplicate', 'notFound'].reduce(addFactory, {});
