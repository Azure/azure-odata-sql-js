// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

var errors = require('./utilities/errors');

var helpers = module.exports = {
    translateVersion: function (items) {
        if(items) {
            if(items.constructor === Array)
                return items.map(helpers.translateVersion);

            if(items.version)
                items.version = items.version.toString('base64');

            return items;
        }
    },
    combineStatements: function (statements, transform) {
        return statements.reduce(function(target, statement) {
            target.sql += statement.sql + '; ';

            if (statement.parameters)
                target.parameters = target.parameters.concat(statement.parameters);

            return target;
        }, { sql: '', parameters: [], multiple: true, transform: transform });
    },
    checkConcurrencyAndTranslate: function (results) {
        var recordsAffected = results[0][0].recordsAffected,
            records = results[1],
            item;

        if (records.length === 0)
            item = undefined;
        else if (records.length === 1)
            item = records[0];
        else
            item = records;

        item = helpers.translateVersion(item);

        if(recordsAffected === 0) {
            var error = errors.concurrency('No records were updated');
            error.item = item;
            throw error;
        }

        return item;
    }
}
