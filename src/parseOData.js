// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

var util = require('util'),
    types = require('./utilities/types'),
    strings = require('./utilities/strings'),
    expressions = require('./expressions');

function ctor(expression) {
    this.keywords = this._createKeywords();

    // define the default root parameter for all member expressions
    this.it = new expressions.Parameter();

    this.text = expression;
    this.textLen = this.text.length;
    this.token = {};
    this._setTextPos(0);
    this._nextToken();
}

var ODataParser = types.defineClass(ctor, {
    parse: function () {
        var expr = this._parseExpression();

        this._validateToken('End', 'Syntax error');
        return expr;
    },

    parseOrdering: function () {
        var orderings = [];
        while (true) {
            var expr = this._parseExpression();
            var ascending = true;
            if (this._tokenIdentifierIs('asc')) {
                this._nextToken();
            }
            else if (this._tokenIdentifierIs('desc')) {
                this._nextToken();
                ascending = false;
            }
            orderings.push({
                selector: expr,
                ascending: ascending
            });
            if (this.token.id != 'Comma') {
                break;
            }
            this._nextToken();
        }
        this._validateToken('End', 'Syntax error');
        return orderings;
    },

    _tokenIdentifierIs: function (id) {
        return this.token.id == 'Identifier' && id == this.token.text;
    },

    _parseExpression: function () {
        return this._parseLogicalOr();
    },

    // 'or' operator
    _parseLogicalOr: function () {
        var left = this._parseLogicalAnd();
        while (this.token.id == 'Or') {
            this._nextToken();
            var right = this._parseLogicalAnd();
            left = new expressions.Binary(left, right, 'Or');
        }
        return left;
    },

    // 'and' operator
    _parseLogicalAnd: function () {
        var left = this._parseComparison();
        while (this.token.id == 'And') {
            this._nextToken();
            var right = this._parseComparison();
            left = new expressions.Binary(left, right, 'And');
        }
        return left;
    },

    _parseComparison: function () {
        var left = this._parseAdditive();
        while (this.token.id == 'Equal' || this.token.id == 'NotEqual' || this.token.id == 'GreaterThan' ||
            this.token.id == 'GreaterThanEqual' || this.token.id == 'LessThan' || this.token.id == 'LessThanEqual') {

            var opId = this.token.id;
            this._nextToken();
            var right = this._parseAdditive();

            switch (opId) {
                case 'Equal':
                    left = new expressions.Binary(left, right, 'Equal');
                    break;
                case 'NotEqual':
                    left = new expressions.Binary(left, right, 'NotEqual');
                    break;
                case 'GreaterThan':
                    left = new expressions.Binary(left, right, 'GreaterThan');
                    break;
                case 'GreaterThanEqual':
                    left = new expressions.Binary(left, right, 'GreaterThanOrEqual');
                    break;
                case 'LessThan':
                    left = new expressions.Binary(left, right, 'LessThan');
                    break;
                case 'LessThanEqual':
                    left = new expressions.Binary(left, right, 'LessThanOrEqual');
                    break;
            }
        }
        return left;
    },

    // 'add','sub' operators
    _parseAdditive: function () {
        var left = this._parseMultiplicative();
        while (this.token.id == 'Add' || this.token.id == 'Sub') {
            var opId = this.token.id;
            this._nextToken();
            var right = this._parseMultiplicative();
            switch (opId) {
                case 'Add':
                    left = new expressions.Binary(left, right, 'Add');
                    break;
                case 'Sub':
                    left = new expressions.Binary(left, right, 'Subtract');
                    break;
            }
        }
        return left;
    },

    // 'mul', 'div', 'mod' operators
    _parseMultiplicative: function () {
        var left = this._parseUnary();
        while (this.token.id == 'Multiply' || this.token.id == 'Divide' ||
                this.token.id == 'Modulo') {
            var opId = this.token.id;
            this._nextToken();
            var right = this._parseUnary();
            switch (opId) {
                case 'Multiply':
                    left = new expressions.Binary(left, right, 'Multiply');
                    break;
                case 'Divide':
                    left = new expressions.Binary(left, right, 'Divide');
                    break;
                case 'Modulo':
                    left = new expressions.Binary(left, right, 'Modulo');
                    break;
            }
        }
        return left;
    },

    // -, 'not' unary operators
    _parseUnary: function () {
        if (this.token.id == 'Minus' || this.token.id == 'Not') {
            var opId = this.token.id;
            var opPos = this.token.pos;
            this._nextToken();
            if (opId == 'Minus' && (this.token.id == 'IntegerLiteral' ||
                this.token.id == 'RealLiteral')) {
                this.token.text = "-" + this.token.text;
                this.token.pos = opPos;
                return this._parsePrimary();
            }

            var expr = this._parseUnary();
            if (opId == 'Minus') {
                expr = new expressions.Unary(expr, 'Negate');
            } else {
                expr = new expressions.Unary(expr, 'Not');
            }
            return expr;
        }
        return this._parsePrimary();
    },

    _parsePrimary: function () {
        var expr = this._parsePrimaryStart();
        while (true) {
            if (this.token.id == 'Dot') {
                this._nextToken();
                expr = this._parseMemberAccess(expr);
            }
            else {
                break;
            }
        }
        return expr;
    },

    _parseMemberAccess: function (instance) {
        var errorPos = this.token.pos;
        var id = this._getIdentifier();
        this._nextToken();
        if (this.token.id == 'OpenParen') {
            var mappedFunction = this._mapFunction(id);
            if (mappedFunction !== null) {
                return this._parseMappedFunction(mappedFunction, errorPos);
            }
            else {
                throw this._parseError(util.format("Unknown identifier '%s'", id), errorPos);
            }
        }
        else {
            return new expressions.Member(instance, id);
        }
    },

    _parseMappedFunction: function (mappedMember, errorPos) {
        var mappedMemberName = mappedMember.memberName;
        var args;
        var instance = null;

        this._beginValidateFunction(mappedMemberName, errorPos);

        if (this.token.id == 'OpenParen') {
            args = this._parseArgumentList();

            this._completeValidateFunction(mappedMemberName, args);

            if (mappedMember.mapParams) {
                mappedMember.mapParams(args);
            }

            // static methods need to include the target
            if (!mappedMember.isStatic) {
                if (args.length === 0) {
                    throw this._parseError(
                        util.format("No applicable method '%s' exists in type '%s'", mappedMember.memberName, mappedMember.type), errorPos);
                }

                instance = args[0];
                args = args.slice(1);
            }
            else {
                instance = null;
            }
        }
        else {
            // if it is a function it should begin with a '('
            throw this._parseError("'(' expected");
        }

        if (mappedMember.isMethod) {
            // a mapped function
            return new expressions.FunctionCall(instance, mappedMember, args);
        }
        else {
            // a mapped Property/Field
            return new expressions.Member(instance, mappedMember);
        }
    },

    _beginValidateFunction: function (functionName, errorPos) {
        if (functionName === 'replace') {
            // Security: nested calls to replace must be prevented to avoid an exploit
            // wherein the client can force the server to allocate arbitrarily large
            // strings.
            if (this.inStringReplace) {
                throw this._parseError("Calls to 'replace' cannot be nested.", errorPos);
            }
            this.inStringReplace = true;
        }
    },

    _completeValidateFunction: function (functionName, functionArgs, errorPos) {
        // validate parameters
        switch (functionName) {
            case 'day':
            case 'month':
            case 'year':
            case 'hour':
            case 'minute':
            case 'second':
            case 'floor':
            case 'ceiling':
            case 'round':
            case 'tolower':
            case 'toupper':
            case 'length':
            case 'trim':
                this._validateFunctionParameters(functionName, functionArgs, 1);
                break;
            case 'substringof':
            case 'startswith':
            case 'endswith':
            case 'concat':
            case 'indexof':
                this._validateFunctionParameters(functionName, functionArgs, 2);
                break;
            case 'replace':
                this._validateFunctionParameters(functionName, functionArgs, 3);
                // Security: we limit the replacement value to avoid an exploit
                // wherein the client can force the server to allocate arbitrarily large
                // strings.
                var replaceArg = functionArgs[2];
                if ((replaceArg.expressionType !== 'Constant') || (replaceArg.value.length > 100)) {
                    throw this._parseError("The third parameter to 'replace' must be a string constant less than 100 in length.", errorPos);
                }
                break;
            case 'substring':
                if (functionArgs.length != 2 && functionArgs.length != 3) {
                    throw new Error("Function 'substring' requires 2 or 3 parameters.");
                }
                break;
        }

        this.inStringReplace = false;
    },

    _validateFunctionParameters: function (functionName, args, expectedArgCount) {
        if (args.length !== expectedArgCount) {
            var error = util.format("Function '%s' requires %d %s",
                functionName, expectedArgCount, (expectedArgCount > 1) ? "parameters." : "parameter.");
            throw new Error(error);
        }
    },

    _parseArgumentList: function () {
        this._validateToken('OpenParen', "'(' expected");
        this._nextToken();
        var args = this.token.id != 'CloseParen' ? this._parseArguments() : [];
        this._validateToken('CloseParen', "')' or ',' expected");
        this._nextToken();
        return args;
    },

    _parseArguments: function () {
        var args = [];
        while (true) {
            args.push(this._parseExpression());
            if (this.token.id != 'Comma') {
                break;
            }
            this._nextToken();
        }
        return args;
    },

    _mapFunction: function (functionName) {
        var mappedMember = this._mapStringFunction(functionName);
        if (mappedMember !== null) {
            return mappedMember;
        }

        mappedMember = this._mapDateFunction(functionName);
        if (mappedMember !== null) {
            return mappedMember;
        }

        mappedMember = this._mapMathFunction(functionName);
        if (mappedMember !== null) {
            return mappedMember;
        }

        return null;
    },

    _mapStringFunction: function (functionName) {
        if (functionName == 'startswith') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'endswith') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'length') {
            return new expressions.MappedMemberInfo('string', functionName, false, false);
        }
        else if (functionName == 'toupper') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'tolower') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'trim') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'substringof') {
            var memberInfo = new expressions.MappedMemberInfo('string', functionName, false, true);
            memberInfo.mapParams = function (args) {
                // reverse the order of arguments for string.Contains
                var tmp = args[0];
                args[0] = args[1];
                args[1] = tmp;
            };
            return memberInfo;
        }
        else if (functionName == 'indexof') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'replace') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'substring') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'trim') {
            return new expressions.MappedMemberInfo('string', functionName, false, true);
        }
        else if (functionName == 'concat') {
            return new expressions.MappedMemberInfo('string', functionName, true, true);
        }

        return null;
    },

    _mapDateFunction: function (functionName) {
        if (functionName == 'day') {
            return new expressions.MappedMemberInfo('date', functionName, false, true);
        }
        else if (functionName == 'month') {
            return new expressions.MappedMemberInfo('date', functionName, false, true);
        }
        else if (functionName == 'year') {
            return new expressions.MappedMemberInfo('date', functionName, false, true);
        }
        if (functionName == 'hour') {
            return new expressions.MappedMemberInfo('date', functionName, false, true);
        }
        else if (functionName == 'minute') {
            return new expressions.MappedMemberInfo('date', functionName, false, true);
        }
        else if (functionName == 'second') {
            return new expressions.MappedMemberInfo('date', functionName, false, true);
        }
        return null;
    },

    _mapMathFunction: function (functionName) {
        if (functionName == 'floor') {
            return new expressions.MappedMemberInfo('math', functionName, false, true);
        }
        else if (functionName == 'ceiling') {
            return new expressions.MappedMemberInfo('math', functionName, false, true);
        }
        else if (functionName == 'round') {
            return new expressions.MappedMemberInfo('math', functionName, false, true);
        }
        return null;
    },

    _getIdentifier: function () {
        this._validateToken('Identifier', 'Identifier expected');
        return this.token.text;
    },

    _parsePrimaryStart: function () {
        switch (this.token.id) {
            case 'Identifier':
                return this._parseIdentifier();
            case 'StringLiteral':
                return this._parseStringLiteral();
            case 'IntegerLiteral':
                return this._parseIntegerLiteral();
            case 'RealLiteral':
                return this._parseRealLiteral();
            case 'OpenParen':
                return this._parseParenExpression();
            default:
                throw this._parseError('Expression expected');
        }
    },

    _parseIntegerLiteral: function () {
        this._validateToken('IntegerLiteral');
        var text = this.token.text;

        // parseInt will return the integer portion of the string, and won't
        // error on something like '1234xyz'.
        var value = parseInt(text, 10);
        if (isNaN(value) || (value != text)) {
            throw this._parseError(util.format("Invalid integer literal '%s'", text));
        }

        this._nextToken();
        if (this.token.text.toUpperCase() == 'L') {
            // in JS there is only one type of integer number, so this code is only here
            // to parse the OData 'L/l' correctly
            this._nextToken();
            return new expressions.Constant(value);
        }
        return new expressions.Constant(value);
    },

    _parseRealLiteral: function () {
        this._validateToken('RealLiteral');
        var text = this.token.text;

        var last = text.slice(-1);
        if (last.toUpperCase() == 'F' || last.toUpperCase() == 'M' || last.toUpperCase() == 'D') {
            // in JS there is only one floating point type,
            // so terminating F/f, M/m, D/d have no effect.
            text = text.slice(0, -1);
        }

        var value = parseFloat(text);

        if (isNaN(value) || (value != text)) {
            throw this._parseError(util.format("Invalid real literal '%s'", text));
        }

        this._nextToken();
        return new expressions.FloatConstant(value);
    },

    _parseParenExpression: function () {
        this._validateToken('OpenParen', "'(' expected");
        this._nextToken();
        var e = this._parseExpression();
        this._validateToken('CloseParen', "')' or operator expected");
        this._nextToken();
        return e;
    },

    _parseIdentifier: function () {
        this._validateToken('Identifier');
        var value = this.keywords[this.token.text];
        if (value) {
            // type construction has the format of type'value' e.g. datetime'2001-04-01T00:00:00Z'
            // therefore if the next character is a single quote then we try to
            // interpret this as type construction else its a normal member access
            if (typeof value === 'string' && this.ch == '\'') {
                return this._parseTypeConstruction(value);
            }
            else if (typeof value !== 'string') {  // this is a constant
                this._nextToken();
                return value;
            }
        }

        if (this.it !== null) {
            return this._parseMemberAccess(this.it);
        }

        throw this._parseError(util.format("Unknown identifier '%s'", this.token.text));
    },

    _parseTypeConstruction: function (type) {
        var typeIdentifier = this.token.text;
        var errorPos = this.token.pos;
        this._nextToken();
        var typeExpression = null;

        if (this.token.id == 'StringLiteral') {
            errorPos = this.token.pos;
            var stringExpr = this._parseStringLiteral();
            var literalValue = stringExpr.value;
            var date = null;

            try {
                if (type == 'datetime') {
                    date = strings.parseISODate(literalValue);
                    if (date) {
                        typeExpression = new expressions.Constant(date);
                    }
                }
                else if (type == 'datetimeoffset') {
                    date = strings.parseDateTimeOffset(literalValue);
                    if (date) {
                        typeExpression = new expressions.Constant(date);
                    }
                }
            }
            catch (e) {
                throw this._parseError(e, errorPos);
            }
        }

        if (!typeExpression) {
            throw this._parseError(util.format("Invalid '%s' type creation expression", typeIdentifier), errorPos);
        }

        return typeExpression;
    },

    _parseStringLiteral: function () {
        this._validateToken('StringLiteral');
        // Unwrap string (remove surrounding quotes) and unwrap escaped quotes.
        var s = this.token.text.substr(1, this.token.text.length - 2).replace(/''/g, "'");

        this._nextToken();
        return new expressions.Constant(s);
    },

    _validateToken: function (tokenId, error) {
        if (this.token.id != tokenId) {
            throw this._parseError(error || 'Syntax error');
        }
    },

    _createKeywords: function () {
        return {
            "true": new expressions.Constant(true),
            "false": new expressions.Constant(false),
            "null": new expressions.Constant(null),

            // type keywords
            datetime: 'datetime',
            datetimeoffset: 'datetimeoffset'
        };
    },

    _setTextPos: function (pos) {
        this.textPos = pos;
        this.ch = this.textPos < this.textLen ? this.text[this.textPos] : '\\0';
    },

    _nextToken: function () {
        while (this._isWhiteSpace(this.ch)) {
            this._nextChar();
        }
        var t; // TokenId
        var tokenPos = this.textPos;
        switch (this.ch) {
            case '(':
                this._nextChar();
                t = 'OpenParen';
                break;
            case ')':
                this._nextChar();
                t = 'CloseParen';
                break;
            case ',':
                this._nextChar();
                t = 'Comma';
                break;
            case '-':
                this._nextChar();
                t = 'Minus';
                break;
            case '/':
                this._nextChar();
                t = 'Dot';
                break;
            case '\'':
                var quote = this.ch;
                do {
                    this._nextChar();
                    while (this.textPos < this.textLen && this.ch != quote) {
                        this._nextChar();
                    }

                    if (this.textPos == this.textLen) {
                        throw this._parseError("Unterminated string literal", this.textPos);
                    }
                    this._nextChar();
                }
                while (this.ch == quote);
                t = 'StringLiteral';
                break;
            default:
                if (this._isIdentifierStart(this.ch) || this.ch == '@' || this.ch == '_') {
                    do {
                        this._nextChar();
                    }
                    while (this._isIdentifierPart(this.ch) || this.ch == '_');
                    t = 'Identifier';
                    break;
                }
                if (strings.isDigit(this.ch)) {
                    t = 'IntegerLiteral';
                    do {
                        this._nextChar();
                    }
                    while (strings.isDigit(this.ch));
                    if (this.ch == '.') {
                        t = 'RealLiteral';
                        this._nextChar();
                        this._validateDigit();
                        do {
                            this._nextChar();
                        }
                        while (strings.isDigit(this.ch));
                    }
                    if (this.ch == 'E' || this.ch == 'e') {
                        t = 'RealLiteral';
                        this._nextChar();
                        if (this.ch == '+' || this.ch == '-') {
                            this._nextChar();
                        }
                        this._validateDigit();
                        do {
                            this._nextChar();
                        }
                        while (strings.isDigit(this.ch));
                    }
                    if (this.ch == 'F' || this.ch == 'f' || this.ch == 'M' || this.ch == 'm' || this.ch == 'D' || this.ch == 'd') {
                        t = 'RealLiteral';
                        this._nextChar();
                    }
                    break;
                }
                if (this.textPos == this.textLen) {
                    t = 'End';
                    break;
                }
                throw this._parseError("Syntax error '" + this.ch + "'", this.textPos);
        }
        this.token.id = t;
        this.token.text = this.text.substr(tokenPos, this.textPos - tokenPos);
        this.token.pos = tokenPos;

        this.token.id = this._reclassifyToken(this.token);
    },

    _reclassifyToken: function (token) {
        if (token.id == 'Identifier') {
            if (token.text == "or") {
                return 'Or';
            }
            else if (token.text == "add") {
                return 'Add';
            }
            else if (token.text == "and") {
                return 'And';
            }
            else if (token.text == "div") {
                return 'Divide';
            }
            else if (token.text == "sub") {
                return 'Sub';
            }
            else if (token.text == "mul") {
                return 'Multiply';
            }
            else if (token.text == "mod") {
                return 'Modulo';
            }
            else if (token.text == "ne") {
                return 'NotEqual';
            }
            else if (token.text == "not") {
                return 'Not';
            }
            else if (token.text == "le") {
                return 'LessThanEqual';
            }
            else if (token.text == "lt") {
                return 'LessThan';
            }
            else if (token.text == "eq") {
                return 'Equal';
            }
            else if (token.text == "ge") {
                return 'GreaterThanEqual';
            }
            else if (token.text == "gt") {
                return 'GreaterThan';
            }
        }

        return token.id;
    },

    _nextChar: function () {
        if (this.textPos < this.textLen) {
            this.textPos++;
        }
        this.ch = this.textPos < this.textLen ? this.text[this.textPos] : '\\0';
    },

    _isWhiteSpace: function (ch) {
        return (/\s/).test(ch);
    },

    _validateDigit: function () {
        if (!strings.isDigit(this.ch)) {
            throw this._parseError('Digit expected', this.textPos);
        }
    },

    _parseError: function (error, pos) {
        pos = pos || this.token.pos || 0;
        return new Error(error + ' (at index ' + pos + ')');
    },

    _isIdentifierStart: function (ch) {
        return strings.isLetter(ch);
    },

    _isIdentifierPart: function (ch) {
        if (this._isIdentifierStart(ch)) {
            return true;
        }

        if (strings.isDigit(ch)) {
            return true;
        }

        if (ch == '_' || ch == '-') {
            return true;
        }

        return false;
    }
});

module.exports = function (predicate) {
    return new ODataParser(predicate).parse();
};

module.exports.orderBy = function (ordering) {
    return new ODataParser(ordering).parseOrdering();
};
