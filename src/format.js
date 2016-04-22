// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

var types = require('./utilities/types'),
    util = require('util'),
    parseOData = require('./parseOData'),
    ExpressionVisitor = require('./ExpressionVisitor'),
    convertTypes = require('./convertTypes'),
    booleanize = require('./booleanize'),
    helpers = require('./helpers'),
    expressions = require('./expressions'),
    mssql = require('mssql');

function ctor(tableConfig) {
    this.tableConfig = tableConfig || {};
    this.flavor = this.tableConfig.flavor || 'mssql';
    this.statement = { sql: '', parameters: [], multiple: true };
    this.paramNumber = 0;
    this.parameterPrefix = 'p';

    if (this.flavor !== 'sqlite') {
        this.schemaName = this.tableConfig.schema || 'dbo';
    }
}

var SqlFormatter = types.deriveClass(ExpressionVisitor, ctor, {
    format: function (query) {
        // if a skip is requested but no top is defined, we need
        // to still generate the paging query, so default top to
        // max. Really when doing paging, the user should also be
        // specifying a top explicitly however.
        if (query.skip > 0 && (query.take === undefined || query.take === null)) {
            if (this.flavor !== 'sqlite') {
                query.take = 9007199254740992; // Number.MAX_SAFE_INTEGER + 1; // ES6
            } else {
                // A negative LIMIT in sqlite returns all rows.
                query.take = -1;
            }
        }

        var statements = [];

        this.statement.sql = this._formatQuery(query).trim();
        statements.push(this.statement);

        if (query.inlineCount === 'allpages' || query.includeTotalCount) {
            this.statement = { sql: '', parameters: [], multiple: true };
            this.statement.sql = this._formatCountQuery(helpers.formatTableName(this.schemaName, query.table), query).trim();
            statements.push(this.statement);
        }

        return statements;
    },

    _formatQuery: function (query) {

        if (this.flavor !== 'sqlite' && query.skip >= 0 && query.take >= 0 && query.skip !== null && query.take !== null) {
            return this._formatPagedQuery(query);
        }

        var takeClause = '',
            skipClause = '',
            whereClause = '',
            orderbyClause = '',
            limit = -1,
            formattedSql,
            selection = query.selections ? this._formatSelection(query.selections) : '*';

        // set the top clause to be the minimumn of the top
        // and result limit values if either has been set.
        var resultLimit = query.resultLimit || Number.MAX_VALUE;
        if (query.take >= 0 && query.take !== null) {
            limit = Math.min(resultLimit, query.take);
        } else if (resultLimit != Number.MAX_VALUE) {
            limit = query.resultLimit;
        }

        if (this.flavor !== 'sqlite') {
            if (limit != -1) {
                takeClause = 'TOP ' + limit.toString() + ' ';
            }
        } else {
            if (query.skip > 0) {
                skipClause = ' OFFSET ' + query.skip.toString();
            }

            // Specifiy a take clause if either skip or limit is specified.
            // Note: SQLite needs LIMIT for OFFSET to work.
            if (query.skip > 0 || limit >= 0) {
                takeClause = ' LIMIT ' + limit.toString();
            }
        }

        var filter = this._formatFilter(query);
        if (filter.length > 0) {
            whereClause = ' WHERE ' + filter;
        }

        var ordering = this._formatOrderBy(query);
        if (ordering.length > 0) {
            orderbyClause = ' ORDER BY ' + ordering;
        }

        var tableName = helpers.formatTableName(this.schemaName, query.table);

        if (this.flavor !== 'sqlite') {
            formattedSql = util.format("SELECT %s%s FROM %s%s%s", takeClause, selection, tableName, whereClause, orderbyClause);
        } else {
            formattedSql = util.format("SELECT %s FROM %s%s%s%s%s", selection, tableName, whereClause, orderbyClause, takeClause, skipClause);
        }

        return formattedSql;
    },

    _formatPagedQuery: function (query) {
        var formattedSql, selection = '',
            aliasedSelection = '';

        if (query.selections) {
            selection = this._formatSelection(query.selections);
            aliasedSelection = '[t1].[ROW_NUMBER], ' + this._formatSelection(query.selections, '[t1].');
        } else {
            selection = aliasedSelection = "*";
        }

        var filter = this._formatFilter(query, '(1 = 1)');
        var ordering = this._formatOrderBy(query, '[id]');

        // Plug all the pieces into the template to get the paging sql
        var tableName = helpers.formatTableName(this.schemaName, query.table);
        formattedSql = util.format(
            "SELECT %s FROM (SELECT ROW_NUMBER() OVER (ORDER BY %s) AS [ROW_NUMBER], %s " +
            "FROM %s WHERE %s) AS [t1] " +
            "WHERE [t1].[ROW_NUMBER] BETWEEN %d + 1 AND %d + %d " +
            "ORDER BY [t1].[ROW_NUMBER]",
            aliasedSelection, ordering, selection, tableName, filter, query.skip, query.skip, query.take);

        return formattedSql;
    },

    _formatCountQuery: function (table, query) {
        var filter;

        if (query.filters || query.id !== undefined || this.tableConfig.supportsSoftDelete) {
            this.statement.sql = '';
            filter = this._formatFilter(query);
        }

        var sql = 'SELECT COUNT(*) AS [count] FROM ' + table;
        if (filter) {
            sql += ' WHERE ' + filter;
        }
        return sql;
    },

    _formatOrderBy: function (query, defaultOrder) {
        if (!query.ordering) {
            return defaultOrder || '';
        }

        var orderings = parseOData.orderBy(query.ordering),
            order = '',
            self = this;

        orderings.forEach(function (ordering) {
            if (order.length > 0) {
                order += ', ';
            }
            self.statement.sql = '';
            self.visit(ordering.selector);
            if (!ordering.ascending) {
                self.statement.sql += ' DESC';
            }
            order += self.statement.sql;
        });

        return order;
    },

    _formatSelection: function (selection, prefix) {
        var formattedSelection = '',
            columns = selection.split(',');

        columns.forEach(function (column) {
            var member = column.trim();
            if (formattedSelection.length > 0) {
                formattedSelection += ', ';
            }
            formattedSelection += (prefix || '') + helpers.formatMember(member);
        });

        return formattedSelection;
    },

    _formatFilter: function (query, defaultFilter) {
        // if we already have a parsed filter use it,
        // otherwise parse the filter
        var filterExpr;
        if (query.filters && query.filters.length > 0) {
            filterExpr = parseOData(query.filters);
        }

        if (query.id !== undefined) {
            var id = this.tableConfig.hasStringId ? "'" + query.id.replace(/'/g, "''") + "'" : query.id;
            var idFilterExpr = parseOData(util.format('(id eq %s)', id));

            // append the id filter to any existing filter
            if (filterExpr) {
                filterExpr = new expressions.Binary(filterExpr, idFilterExpr, 'And');
            }
            else {
                filterExpr = idFilterExpr;
            }
        }

        // if soft delete is enabled filter out deleted records
        if (this.tableConfig.softDelete && !query.includeDeleted) {
            var deletedFilter = parseOData(util.format('(deleted eq false)'));
            if (filterExpr) {
                filterExpr = new expressions.Binary(filterExpr, deletedFilter, 'And');
            }
            else {
                filterExpr = deletedFilter;
            }
        }

        if (!filterExpr) {
            return defaultFilter || '';
        }

        this.statement.sql = '';
        filterExpr = this._finalizeExpression(filterExpr);
        this.visit(filterExpr);

        return this.statement.sql;
    },

    // run the final query translation pipeline on the specified
    // expression, modifying the expression tree as needed
    _finalizeExpression: function (expr) {
        expr = booleanize(expr);
        expr = convertTypes(expr, this.tableConfig);
        return expr;
    },

    visitBinary: function (expr) {
        this.statement.sql += '(';

        var left = null;
        var right = null;

        // modulo requires the dividend to be an integer, monetary or numeric
        // rewrite the expression to convert to numeric, allowing the DB to apply
        // rounding if needed. our default data type for number is float which
        // is incompatible with modulo.
        if (expr.expressionType == 'Modulo') {
            expr.left = new expressions.Convert('numeric', expr.left);
        }

        if (expr.left) {
            left = this.visit(expr.left);
        }

        if (expr.right && (expr.right.value === null)) {
            // inequality expressions against a null literal have a special
            // translation in SQL
            if (expr.expressionType == 'Equal') {
                this.statement.sql += ' IS NULL';
            }
            else if (expr.expressionType == 'NotEqual') {
                this.statement.sql += ' IS NOT NULL';
            }
        }
        else {
            switch (expr.expressionType) {
                case 'Equal':
                    this.statement.sql += ' = ';
                    break;
                case 'NotEqual':
                    this.statement.sql += ' != ';
                    break;
                case 'LessThan':
                    this.statement.sql += ' < ';
                    break;
                case 'LessThanOrEqual':
                    this.statement.sql += ' <= ';
                    break;
                case 'GreaterThan':
                    this.statement.sql += ' > ';
                    break;
                case 'GreaterThanOrEqual':
                    this.statement.sql += ' >= ';
                    break;
                case 'And':
                    this.statement.sql += ' AND ';
                    break;
                case 'Or':
                    this.statement.sql += ' OR ';
                    break;
                case 'Add':
                    this.statement.sql += ' + ';
                    break;
                case 'Subtract':
                    this.statement.sql += ' - ';
                    break;
                case 'Multiply':
                    this.statement.sql += ' * ';
                    break;
                case 'Divide':
                    this.statement.sql += ' / ';
                    break;
                case 'Modulo':
                    this.statement.sql += ' % ';
                    break;
            }

            if (expr.right) {
                right = this.visit(expr.right);
            }
        }

        this.statement.sql += ')';

        if ((left !== expr.left) || (right !== expr.right)) {
            return new expressions.Binary(left, right);
        }

        return expr;
    },

    visitConstant: function (expr) {
        if (expr.value === null) {
            this.statement.sql += 'NULL';
            return expr;
        }

        this.statement.sql += this._createParameter(expr.value);

        return expr;
    },

    visitFloatConstant: function (expr) {
        if (expr.value === null) {
            this.statement.sql += 'NULL';
            return expr;
        }

        this.statement.sql += this._createParameter(expr.value, mssql.FLOAT);

        return expr;
    },

    _createParameter: function (value, type) {
        var parameter = {
            name: this.parameterPrefix + (++this.paramNumber).toString(),
            pos: this.paramNumber,
            value: value,
            type: type
        };

        this.statement.parameters.push(parameter);

        return '@' + this.parameterPrefix + this.paramNumber.toString();
    },

    visitMember: function (expr) {
        if (typeof expr.member === 'string') {
            this.statement.sql += helpers.formatMember(expr.member);
        }
        else {
            this._formatMappedMember(expr);
        }

        return expr;
    },

    visitUnary: function (expr) {
        if (expr.expressionType == 'Not') {
            this.statement.sql += 'NOT ';
            this.visit(expr.operand);
        }
        else if (expr.expressionType == 'Convert') {
            this.statement.sql += util.format("CONVERT(%s, ", expr.desiredType);
            this.visit(expr.operand);
            this.statement.sql += ')';
        }

        return expr;
    },

    visitFunction: function (expr) {
        if (expr.memberInfo) {
            this._formatMappedFunction(expr);
        }
        return expr;
    },

    _formatMappedFunction: function (expr) {
        if (expr.memberInfo.type == 'string') {
            this._formatMappedStringMember(expr.instance, expr.memberInfo, expr.args);
        }
        else if (expr.memberInfo.type == 'date') {
            this._formatMappedDateMember(expr.instance, expr.memberInfo, expr.args);
        }
        else if (expr.memberInfo.type == 'math') {
            this._formatMappedMathMember(expr.instance, expr.memberInfo, expr.args);
        }
    },

    _formatMappedMember: function (expr) {
        if (expr.member.type == 'string') {
            this._formatMappedStringMember(expr.instance, expr.member, null);
        }
    },

    _formatMappedDateMember: function (instance, mappedMemberInfo, args) {
        var functionName = mappedMemberInfo.memberName;

        if (functionName == 'day') {
            this.statement.sql += 'DAY(';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (mappedMemberInfo.memberName == 'month') {
            this.statement.sql += 'MONTH(';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (mappedMemberInfo.memberName == 'year') {
            this.statement.sql += 'YEAR(';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (mappedMemberInfo.memberName == 'hour') {
            this.statement.sql += 'DATEPART(HOUR, ';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (mappedMemberInfo.memberName == 'minute') {
            this.statement.sql += 'DATEPART(MINUTE, ';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (mappedMemberInfo.memberName == 'second') {
            this.statement.sql += 'DATEPART(SECOND, ';
            this.visit(instance);
            this.statement.sql += ')';
        }
    },

    _formatMappedMathMember: function (instance, mappedMemberInfo, args) {
        var functionName = mappedMemberInfo.memberName;

        if (functionName == 'floor') {
            this.statement.sql += 'FLOOR(';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (functionName == 'ceiling') {
            this.statement.sql += 'CEILING(';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (functionName == 'round') {
            // Use the 'away from zero' midpoint rounding strategy - when
            // a number is halfway between two others, it is rounded toward
            // the nearest number that is away from zero.
            this.statement.sql += 'ROUND(';
            this.visit(instance);
            this.statement.sql += ', 0)';
        }
    },

    _formatMappedStringMember: function (instance, mappedMemberInfo, args) {
        var functionName = mappedMemberInfo.memberName;

        if (functionName == 'substringof') {
            this.statement.sql += '(';
            this.visit(instance);

            this.statement.sql += ' LIKE ';

            // form '%' + <arg> + '%'
            this.statement.sql += "('%' + ";
            this.visit(args[0]);
            this.statement.sql += " + '%')";

            this.statement.sql += ')';
        }
        else if (functionName == 'startswith') {
            this.statement.sql += '(';
            this.visit(instance);

            this.statement.sql += ' LIKE ';

            // form '<arg> + '%'
            this.statement.sql += '(';
            this.visit(args[0]);
            this.statement.sql += " + '%')";

            this.statement.sql += ')';
        }
        else if (functionName == 'endswith') {
            this.statement.sql += '(';
            this.visit(instance);

            this.statement.sql += ' LIKE ';

            // form '%' + '<arg>
            this.statement.sql += "('%' + ";
            this.visit(args[0]);
            this.statement.sql += ')';

            this.statement.sql += ')';
        }
        else if (functionName == 'concat') {
            // Rewrite as an string addition with appropriate conversions.
            // Note: due to sql operator precidence, we only need to inject a
            // single conversion - the other will be upcast to string.
            if (!isConstantOfType(args[0], 'string')) {
                args[0] = new expressions.Convert(helpers.getSqlType(''), args[0]);
            } else if (!isConstantOfType(args[1], 'string')) {
                args[1] = new expressions.Convert(helpers.getSqlType(''), args[1]);
            }
            var concat = new expressions.Binary(args[0], args[1], 'Add');
            this.visit(concat);
        }
        else if (functionName == 'tolower') {
            this.statement.sql += 'LOWER(';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (functionName == 'toupper') {
            this.statement.sql += 'UPPER(';
            this.visit(instance);
            this.statement.sql += ')';
        }
        else if (functionName == 'length') {
            // special translation since SQL LEN function doesn't
            // preserve trailing spaces
            this.statement.sql += '(LEN(';
            this.visit(instance);
            this.statement.sql += " + 'X') - 1)";
        }
        else if (functionName == 'trim') {
            this.statement.sql += 'LTRIM(RTRIM(';
            this.visit(instance);
            this.statement.sql += '))';
        }
        else if (functionName == 'indexof') {
            this.statement.sql += "(PATINDEX('%' + ";
            this.visit(args[0]);
            this.statement.sql += " + '%', ";
            this.visit(instance);
            this.statement.sql += ') - 1)';
        }
        else if (functionName == 'replace') {
            this.statement.sql += "REPLACE(";
            this.visit(instance);
            this.statement.sql += ", ";
            this.visit(args[0]);
            this.statement.sql += ", ";
            this.visit(args[1]);
            this.statement.sql += ')';
        }
        else if (functionName == 'substring') {
            this.statement.sql += 'SUBSTRING(';
            this.visit(instance);

            this.statement.sql += ", ";
            this.visit(args[0]);
            this.statement.sql += " + 1, ";  // need to add 1 since SQL is 1 based, but OData is zero based

            if (args.length == 1) {
                // Overload not taking an explicit length. The
                // LEN of the entire expression is used in this case
                // which means everything after the start index will
                // be taken.
                this.statement.sql += 'LEN(';
                this.visit(instance);
                this.statement.sql += ')';
            }
            else if (args.length == 2) {
                // overload taking a length
                this.visit(args[1]);
            }

            this.statement.sql += ')';
        }
    }
});

function isConstantOfType(expr, type) {
    return (expr.expressionType == 'Constant') && (typeof expr.value === type);
}

// query should be in the format as generated by query.js toOData function
module.exports = function (query, tableConfig) {
    query.table = (tableConfig && (tableConfig.containerName || tableConfig.databaseTableName || tableConfig.name)) || query.table;
    var formatter = new SqlFormatter(tableConfig);
    return formatter.format(query);
};

module.exports.filter = function (query, parameterPrefix, tableConfig) {
    var formatter = new SqlFormatter(tableConfig);
    formatter.parameterPrefix = parameterPrefix || 'p';
    formatter._formatFilter(query);
    return formatter.statement;
};
