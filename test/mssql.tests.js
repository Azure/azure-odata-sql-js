// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------
var formatSql = require('../src/format'),
    equal = require('assert').equal;

describe('azure-odata-sql.mssql', function () {
    it("preserves float parameters with zeroes", function () {
        var query = {
            table: 'intIdMovies',
            filters: 'ceiling((Duration div 60.0)) eq 2.0'
        },
            statements = formatSql(query, { schema: 'testapp'});
        equal(statements.length, 1);
        equal(statements[0].parameters[1].type, 'float');
    });

    it("correctly handles null take", function () {
        var query = {
            table: 'intIdMovies',
            filters: '((Duration eq Duration))',
            orderClauses: "Title",
            ordering: "Title",
            skip: 500,
            take: null
        },
            expectedSql = "SELECT * " +
            "FROM [testapp].[intIdMovies] WHERE ([Duration] = [Duration]) " +
            "ORDER BY [Title] " + 
            "OFFSET 500 ROWS FETCH NEXT 9007199254740992 ROWS ONLY";

        verifySqlFormatting(query, expectedSql);
    });

    it("adds totalCount query when specified", function () {
        var query = {
            table: 'intIdMovies',
            skip: 10,
            take: 10,
            includeTotalCount: true
        },
            expectedSql = [
                "SELECT * FROM [testapp].[intIdMovies] WHERE (1 = 1) ORDER BY [id] OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY",
                "SELECT COUNT(*) AS [count] FROM [testapp].[intIdMovies]"
            ];

        verifySqlFormatting(query, expectedSql);
    })

    it("generates correct parameter names", function () {
        var query = {
                table: 'books',
                filters: "(col1 eq 1) and (col2 eq 2)",
            },
            expectedSql = "SELECT * FROM [testapp].[books] WHERE (([col1] = @p1) AND ([col2] = @p2))",
            statements = verifySqlFormatting(query, expectedSql);

        equal(statements.length, 1);
        equal(statements[0].parameters[0].name, 'p1');
        equal(statements[0].parameters[1].name, 'p2');
    })

    it("query with skip no top", function () {
        var query = {
                table: 'books',
                filters: "(type eq 'psychology') and (price lt 25.00)",
                skip: 4
            },
            expectedSql = "SELECT * FROM [testapp].[books] WHERE (([type] = @p1) AND ([price] < @p2)) ORDER BY [id] OFFSET 4 ROWS FETCH NEXT 9007199254740992 ROWS ONLY";

        verifySqlFormatting(query, expectedSql);
    });

    it("query on constants", function () {
        var query = {
                table: 'books',
                filters: "(true eq null) and false",
            },
            expectedSql = "SELECT * FROM [testapp].[books] WHERE ((@p1 IS NULL) AND (@p2 = @p3))",
            statements = verifySqlFormatting(query, expectedSql);

        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, true);
        equal(statements[0].parameters[1].value, false);
        equal(statements[0].parameters[2].value, true);
    });

    it("query on datetime field", function () {
        var query = {
                table: 'books',
                filters: "datetime eq 1",
            },
            expectedSql = "SELECT * FROM [testapp].[books] WHERE ([datetime] = @p1)",
            statements = verifySqlFormatting(query, expectedSql);

        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 1);
    });

    it("query with no select but includeDeleted", function () {
        var query = {
                table: 'checkins',
                includeDeleted: true
            },
            expectedSql = "SELECT * FROM [testapp].[checkins]";

        verifySqlFormatting(query, expectedSql, { hasStringId: true, softDelete: true });
    });

    it("query with no select but without includeDeleted", function () {
        var query = {
                table: 'checkins'
            },
            expectedSql = "SELECT * FROM [testapp].[checkins] WHERE ([deleted] = @p1)";

        verifySqlFormatting(query, expectedSql, { hasStringId: true, softDelete: true });
    });

    it("query with top, skip and no select but without includeDeleted", function () {
        var query = {
                table: 'checkins',
                skip: 4,
                take: 4
            },
            expectedSql = "SELECT * FROM [testapp].[checkins] WHERE ([deleted] = @p1) ORDER BY [id] OFFSET 4 ROWS FETCH NEXT 4 ROWS ONLY";

        verifySqlFormatting(query, expectedSql, { hasStringId: true, softDelete: true });
    });

    it("inline count with paging and filter", function () {
        var query = {
            table: 'books',
            filters: "(type eq 'psychology') and (price lt 25.00)",
            selections: 'title,type,price',
            skip: 4,
            take: 4,
            inlineCount: 'allpages'
        };
        var expectedSql = [
            "SELECT [title], [type], [price] FROM [testapp].[books] WHERE (([type] = @p1) AND ([price] < @p2)) ORDER BY [id] OFFSET 4 ROWS FETCH NEXT 4 ROWS ONLY",
            "SELECT COUNT(*) AS [count] FROM [testapp].[books] WHERE (([type] = @p3) AND ([price] < @p4))"
        ];

        var statements = verifySqlFormatting(query, expectedSql);

        equal(statements.length, 2);
        equal(statements[0].parameters[0].value, 'psychology');
        equal(statements[0].parameters[1].value, 25);
        equal(statements[1].parameters[0].value, 'psychology');
        equal(statements[1].parameters[1].value, 25);
    });

    it("basic statement test", function () {
        var query = {
                table: 'checkins',
                filters: "(user eq 'mathewc')"
            },
            expectedSql = "SELECT * FROM [testapp].[checkins] WHERE ([user] = @p1)";

        verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [] });
    });

    it("advanced statement tests", function () {
        var query = {
                table: 'products',
                filters: "((ProductName ne 'Doritos') or (UnitPrice lt 5.00))"
            },
            expectedSql = "SELECT * FROM [testapp].[products] WHERE (([ProductName] != @p1) OR ([UnitPrice] < @p2))";

        verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [] });

        query = {
            table: 'products',
            filters: "((ProductName ne 'Doritos') or (UnitPrice lt 5.00))",
            selections: 'ProductID, ProductName',
            ordering: 'UnitPrice asc',
            resultLimit: 1000
        };
        expectedSql = "SELECT TOP 1000 [ProductID], [ProductName] FROM [testapp].[products] WHERE (([ProductName] != @p1) OR ([UnitPrice] < @p2)) ORDER BY [UnitPrice]";
        verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [] });

        query.take = 5;
        expectedSql = "SELECT TOP 5 [ProductID], [ProductName] FROM [testapp].[products] WHERE (([ProductName] != @p1) OR ([UnitPrice] < @p2)) ORDER BY [UnitPrice]";
        verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [] });
    });

    it("test ordering", function () {
        var query = {
                table: 'products',
                filters: "((ProductName ne 'Doritos') or (UnitPrice lt 5.00))",
                ordering: "UnitPrice desc"
            },
            expectedSql = "SELECT * FROM [testapp].[products] WHERE (([ProductName] != @p1) OR ([UnitPrice] < @p2)) ORDER BY [UnitPrice] DESC";

        var statements = verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [] });
        equal(statements.length, 1);
        equal(statements[0].parameters.length, 2);
        equal(statements[0].parameters[0].value, 'Doritos');
        equal(statements[0].parameters[1].value, 5.00);
    });

    it("test multipart ordering", function () {
        var query = {
                table: 'products',
                ordering: "UnitPrice desc, Category, ProductName"
            },
            expectedSql = "SELECT * FROM [testapp].[products] ORDER BY [UnitPrice] DESC, [Category], [ProductName]";

        verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [] });
    });

    it("simple multipart query", function () {
        var query = {
            table: 'products',
            filters: "name eq 'Doritos'",
            ordering: "price",
            take: 100
        };
        verifySqlFormatting(query, "SELECT TOP 100 * FROM [testapp].[products] WHERE ([name] = @p1) ORDER BY [price]");
    });

    it("orderby", function () {
        var query = {
            table: 'products',
            ordering: 'price'
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] ORDER BY [price]");
    });

    it("orderby ascending descending", function () {
        var query = {
            table: 'products',
            ordering: 'price asc'
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] ORDER BY [price]");

        query.ordering = 'price desc';
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] ORDER BY [price] DESC");
    });

    it("equality operator", function () {
        var query = {
            table: 'products',
            filters: "name eq 'Doritos'"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] = @p1)");
    });

    it("not equal operator", function () {
        var query = {
            table: 'products',
            filters: "name ne 'Doritos'"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] != @p1)");
    });

    it("greater than operator", function () {
        var query = {
            table: 'products',
            filters: "price gt 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([price] > @p1)");
    });

    it("greater than equal operator", function () {
        var query = {
            table: 'products',
            filters: "price ge 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([price] >= @p1)");
    });

    it("less than operator", function () {
        var query = {
            table: 'products',
            filters: "price lt 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([price] < @p1)");
    });

    it("less than equal operator", function () {
        var query = {
            table: 'products',
            filters: "price le 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([price] <= @p1)");
    });

    it("or operator", function () {
        var query = {
            table: 'products',
            filters: "price le 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([price] <= @p1)");
    });

    it("negative numbers", function () {
        var query = {
            table: 'products',
            filters: "price eq 5.00 or price eq 10.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (([price] = @p1) OR ([price] = @p2))");
    });

    it("and operator", function () {
        var query = {
            table: 'products',
            filters: "price gt 5.00 and price lt 10.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (([price] > @p1) AND ([price] < @p2))");
    });

    it("negation operator", function () {
        var query = {
            table: 'products'
        };

        // boolean odata functions
        query.filters = "not(substringof('foo', name))";
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT ([name] LIKE ('%' + @p1 + '%'))");

        // inequality
        query.filters = "not(price lt 5.00)";
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT ([price] < @p1)");

        // simple not requiring no conversion
        query.filters = "not(price eq 5.00)";
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT ([price] = @p1)");

        // non boolean expression
        query.filters = "not(discontinued)";
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT ([discontinued] = @p1)");
        equal(statements.length, 1);
        equal((statements[0].parameters[0].value === true), true);

        // nested not
        query.filters = "not(not(discontinued))";
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT NOT ([discontinued] = @p1)");
    });

    it("subtraction", function () {
        var query = {
            table: 'products',
            filters: "price sub 1.00 lt 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (([price] - @p1) < @p2)");
    });

    // verifies that bit expressions are translated to boolean expressions when required
    it("bit to boolean conversion", function () {
        var query = {
            table: 'products',
            filters: 'not(discontinued)'
        };

        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT ([discontinued] = @p1)");
        equal(statements.length, 1);
        equal((statements[0].parameters[0].value === true), true);

        query.filters = 'discontinued';
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([discontinued] = @p1)");
        equal(statements.length, 1);
        equal((statements[0].parameters[0].value === true), true);

        query.table = 'person';
        query.filters = 'likesBeer and isMale';
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[person] WHERE (([likesBeer] = @p1) AND ([isMale] = @p2))");
        equal(statements.length, 1);
        equal((statements[0].parameters[0].value === true), true);
        equal((statements[0].parameters[1].value === true), true);

        query.table = 'person';
        query.filters = 'not(isUgly) and (likesBeer or isMale)';
        verifySqlFormatting(query, "SELECT * FROM [testapp].[person] WHERE (NOT ([isUgly] = @p1) AND (([likesBeer] = @p2) OR ([isMale] = @p3)))");
    });

    // verifies that when any boolean expression is compared to a bit literal (true/false)
    // the expression is rewritten to remove the comparison
    it("boolean comparison to bit", function () {
        var query = {
            table: 'products',
            filters: "substringof('foo', name) eq true"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] LIKE ('%' + @p1 + '%'))");

        query.filters = "substringof('foo', name) eq false";
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT ([name] LIKE ('%' + @p1 + '%'))");

        query.filters = "true eq substringof('foo', name)";
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] LIKE ('%' + @p1 + '%'))");

        query.filters = "false eq substringof('foo', name)";
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE NOT ([name] LIKE ('%' + @p1 + '%'))");

        query.table = 'person';
        query.filters = '(likesBeer or isMale) eq true';
        verifySqlFormatting(query, "SELECT * FROM [testapp].[person] WHERE (([likesBeer] = @p1) OR ([isMale] = @p2))");

        query.table = 'person';
        query.filters = 'false eq (likesBeer or isMale)';
        verifySqlFormatting(query, "SELECT * FROM [testapp].[person] WHERE NOT (([likesBeer] = @p1) OR ([isMale] = @p2))");
    });

    it("mixed bit boolean conversions", function () {
        var query = {
            table: 'person',
            filters: "(endswith(name, 'foo') eq true) and (likesBeer)"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[person] WHERE (([name] LIKE ('%' + @p1)) AND ([likesBeer] = @p2))");
    });

    it("addition", function () {
        var query = {
            table: 'products',
            filters: "price add 1.00 lt 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (([price] + @p1) < @p2)");
    });

    it("multiplication", function () {
        var query = {
            table: 'products',
            filters: "price mul 1.25 lt 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (([price] * @p1) < @p2)");
    });

    it("division", function () {
        var query = {
            table: 'products',
            filters: "price div 1.25 lt 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (([price] / @p1) < @p2)");
    });

    // Bug#599392
    it("modulo", function () {
        var query = {
            table: 'products',
            filters: "price mod 1.25 lt 5.00"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ((CONVERT(numeric, [price]) % @p1) < @p2)");
    });

    it("grouping", function () {
        var query = {
            table: 'products',
            filters: "((name ne 'Doritos') or (price lt 5.00))"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (([name] != @p1) OR ([price] < @p2))");
    });

    it("null literal equality", function () {
        var query = {
            table: 'products',
            filters: "name eq null"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] IS NULL)");
    });

    it("null literal inequality", function () {
        var query = {
            table: 'products',
            filters: "name ne null"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] IS NOT NULL)");
    });

    it("string length", function () {
        var query = {
            table: 'products',
            filters: "length(name) gt 5"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ((LEN([name] + 'X') - 1) > @p1)");

        // pass a string concat expression into length
        query = {
            table: 'products',
            filters: "length(concat(name, category)) gt 5"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ((LEN((CONVERT(NVARCHAR(MAX), [name]) + [category]) + 'X') - 1) > @p1)");
    });

    it("string startswith", function () {
        var query = {
            table: 'products',
            filters: "startswith(name, 'Abc')"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] LIKE (@p1 + '%'))");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 'Abc');
    });

    it("string endswith", function () {
        var query = {
            table: 'products',
            filters: "endswith(name, 'Abc')"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] LIKE ('%' + @p1))");
    });

    it("string substringof", function () {
        var query = {
            table: 'products',
            filters: "substringof('Abc', name)"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ([name] LIKE ('%' + @p1 + '%'))");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 'Abc');
    });

    it("string indexof", function () {
        var query = {
            table: 'products',
            filters: "indexof(name, 'Abc') eq 5"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ((PATINDEX('%' + @p1 + '%', [name]) - 1) = @p2)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 'Abc');
        equal(statements[0].parameters[1].value, 5);
    });

    it("string concat", function () {
        var query = {
            table: 'customers',
            filters: "concat(concat(city, ', '), country) eq 'Berlin, Germany'"
        };
        var statements = verifySqlFormatting(query,
            "SELECT * FROM [testapp].[customers] WHERE ((CONVERT(NVARCHAR(MAX), (CONVERT(NVARCHAR(MAX), [city]) + @p1)) + [country]) = @p2)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, ', ');
        equal(statements[0].parameters[1].value, 'Berlin, Germany');
    });

    it("string replace", function () {
        var query = {
            table: 'products',
            filters: "replace(name, ' ', '') eq 'ApplePie'"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (REPLACE([name], @p1, @p2) = @p3)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, ' ');
        equal(statements[0].parameters[1].value, '');
        equal(statements[0].parameters[2].value, 'ApplePie');
    });

    it("string substring", function () {
        // first overload not taking an explicit length - will return
        // the rest of the string
        var query = {
            table: 'books',
            filters: "substring(title, 1) eq 'he Rise and Fall of the Roman Empire'"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[books] WHERE (SUBSTRING([title], @p1 + 1, LEN([title])) = @p2)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 1);
        equal(statements[0].parameters[1].value, 'he Rise and Fall of the Roman Empire');

        // second overload taking a length
        query.filters = "substring(title, 1, 10) eq 'he Rise and Fall of the Roman Empire'";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[books] WHERE (SUBSTRING([title], @p1 + 1, @p2) = @p3)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 1);
        equal(statements[0].parameters[1].value, 10);
        equal(statements[0].parameters[2].value, 'he Rise and Fall of the Roman Empire');
    });

    it("string trim", function () {
        var query = {
            table: 'products',
            filters: "trim(name) eq 'foobar'"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (LTRIM(RTRIM([name])) = @p1)");
    });

    it("string tolower", function () {
        var query = {
            table: 'products',
            filters: "tolower(name) eq 'tasty treats'"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (LOWER([name]) = @p1)");
    });

    it("string toupper", function () {
        var query = {
            table: 'products',
            filters: "toupper(name) eq 'TASTY TREATS'"
        };
        verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE (UPPER([name]) = @p1)");
    });

    it("string concat", function () {
        var query = {
            table: 'products',
            filters: "concat(name, 'Bar') eq 'FooBar'"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[products] WHERE ((CONVERT(NVARCHAR(MAX), [name]) + @p1) = @p2)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 'Bar');
        equal(statements[0].parameters[1].value, 'FooBar');
    });

    it("date functions ", function () {
        var query = {
            table: 'checkins',
            filters: "day(checkinDate) lt 25"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE (DAY([checkinDate]) < @p1)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 25);

        query.filters = "month(checkinDate) eq 8";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE (MONTH([checkinDate]) = @p1)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 8);

        query.filters = "year(checkinDate) gt 1974";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE (YEAR([checkinDate]) > @p1)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 1974);

        query.filters = "hour(checkinDate) gt 6";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE (DATEPART(HOUR, [checkinDate]) > @p1)");

        query.filters = "minute(checkinDate) eq 33";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE (DATEPART(MINUTE, [checkinDate]) = @p1)");

        query.filters = "second(checkinDate) lt 30";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE (DATEPART(SECOND, [checkinDate]) < @p1)");
    });

    it("math functions", function () {
        var query = {
            table: 'books',
            filters: "floor(price) lt 77"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[books] WHERE (FLOOR([price]) < @p1)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 77);

        query.filters = "ceiling(price) eq 8";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[books] WHERE (CEILING([price]) = @p1)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 8);

        query.filters = "round(price) gt 19.00";
        statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[books] WHERE (ROUND([price], 0) > @p1)");
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, 19.00);
    });

    it("simple paging query", function () {
        var query = {
            table: 'books',
            skip: 4,
            take: 4
        };
        var expectedSql = "SELECT * FROM [testapp].[books] WHERE (1 = 1) ORDER BY [id] OFFSET 4 ROWS FETCH NEXT 4 ROWS ONLY";
        verifySqlFormatting(query, expectedSql);
    });

    it("uses table specified in table config", function () {
        var query = {
            table: 'query'
        };
        var expectedSql = "SELECT * FROM [testapp].[tableName]";
        verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [], schema: 'testapp', name: 'tableName' });
    })

    it("paging query with filter and select", function () {
        var query = {
            table: 'books',
            filters: "type eq 'psychology'",
            selections: 'title,type,price',
            skip: 4,
            take: 4
        };
        var expectedSql = "SELECT [title], [type], [price] FROM [testapp].[books] WHERE ([type] = @p1) ORDER BY [id] OFFSET 4 ROWS FETCH NEXT 4 ROWS ONLY";
        verifySqlFormatting(query, expectedSql);
    });

    it("paging query with filter and select and ordering", function () {
        var query = {
            table: 'books',
            filters: "type eq 'psychology'",
            selections: 'title,type,price',
            ordering: 'price desc',
            skip: 4,
            take: 4
        };
        var expectedSql = "SELECT [title], [type], [price] FROM [testapp].[books] WHERE ([type] = @p1) ORDER BY [price] DESC OFFSET 4 ROWS FETCH NEXT 4 ROWS ONLY";
        verifySqlFormatting(query, expectedSql);
    });

    it("datetime expression", function () {
        var query = {
            table: 'checkins',
            filters: "checkinDate lt datetime'2000-12-12T12:00:00Z'"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE ([checkinDate] < @p1)");

        equal(statements.length, 1);
        var value = statements[0].parameters[0].value;
        equal(value.constructor, Date);

        // try a parse failure case
        var expectedExceptionCaught = false;
        try {
            query.filters = "checkinDate lt datetime'2000x12-12blah2:00'";
            verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE ([checkinDate] < @p1)");
        }
        catch (e) {
            expectedExceptionCaught = true;
            equal(e.message, "Invalid 'datetime' type creation expression (at index 23)");
        }
        equal(expectedExceptionCaught, true);
    });

    it("datetimeoffset expression", function () {
        var query = {
            table: 'checkins',
            filters: "checkinDate lt datetimeoffset'2000-12-12T04:00:00.0000000-08:00'"
        };
        var statements = verifySqlFormatting(query, "SELECT * FROM [testapp].[checkins] WHERE ([checkinDate] < @p1)");

        equal(statements.length, 1);
        var value = statements[0].parameters[0].value;
        equal(value.constructor, Date);
        equal(value.toISOString(), '2000-12-12T12:00:00.000Z');
    });

    it("parse multiple quotes", function () {
        var query = {
                table: 'products',
                filters: "description eq 'lots of qu''ote''''s i''n he''r''e!'"
            },
            expectedSql = "SELECT * FROM [testapp].[products] WHERE ([description] = @p1)";

        var statements = verifySqlFormatting(query, expectedSql, { idType: "number", binaryColumns: [] })
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value, "lots of qu'ote''s i'n he'r'e!");
    });

    it("converts base64 version columns to binary buffers", function () {
        var query = {
                table: 'products',
                filters: "version eq 'AAAAAAAAUDU='"
            },
            statements = formatSql(query, { schema: 'testapp' });
        equal(statements.length, 1);
        equal(statements[0].parameters[0].value.constructor, Buffer);
        equal(statements[0].parameters[0].value.toString('base64'), 'AAAAAAAAUDU=');
    });

    it("verify function arguments", function () {
        var testCases = [
            // date functions
            { filters: "day(a, b, c)", expectedParamCount: 1 },
            { filters: "day()", expectedParamCount: 1 },
            { filters: "month(a, b, c)", expectedParamCount: 1 },
            { filters: "month()", expectedParamCount: 1 },
            { filters: "year(a, b, c)", expectedParamCount: 1 },
            { filters: "year()", expectedParamCount: 1 },
            { filters: "hour()", expectedParamCount: 1 },
            { filters: "minute()", expectedParamCount: 1 },
            { filters: "second()", expectedParamCount: 1 },
            { filters: "floor(a, b, c)", expectedParamCount: 1 },
            { filters: "ceiling(a, b, c)", expectedParamCount: 1 },
            { filters: "round(a, b, c)", expectedParamCount: 1 },

            // string functions
            { filters: "substringof(a)", expectedParamCount: 2 },
            { filters: "endswith(a)", expectedParamCount: 2 },
            { filters: "startswith(a)", expectedParamCount: 2 },
            { filters: "concat(a)", expectedParamCount: 2 },
            { filters: "tolower(a, b)", expectedParamCount: 1 },
            { filters: "toupper()", expectedParamCount: 1 },
            { filters: "length()", expectedParamCount: 1 },
            { filters: "trim(a, 5)", expectedParamCount: 1 },
            { filters: "indexof(a)", expectedParamCount: 2 },
            { filters: "replace(a)", expectedParamCount: 3 },
            { filters: "substring(a)", expectedParamCount: 3, expectedError: "Function 'substring' requires 2 or 3 parameters." },
            { filters: "concat()", expectedParamCount: 2 },

            // math functions
            { filters: "floor()", expectedParamCount: 1 },
            { filters: "ceiling()", expectedParamCount: 1 },
            { filters: "round()", expectedParamCount: 1 }
        ];

        for (var idx in testCases) {
            var testCase = testCases[idx],
                query = {
                    table: 'foo',
                    filters: testCase.filters
                },
                expectedExceptionCaught = false;

            try {
                formatSql(query, 'testapp', { idType: "number", binaryColumns: [] });
            }
            catch (e) {
                expectedExceptionCaught = true;
                var expectedError;
                if (!testCase.expectedError) {
                    var parenIdx = testCase.filters.indexOf('(');
                    var functionName = testCase.filters.substr(0, parenIdx);
                    expectedError = "Function '" + functionName + "' requires " + testCase.expectedParamCount;
                    expectedError += (testCase.expectedParamCount > 1) ? " parameters." : " parameter.";
                }
                else {
                    expectedError = testCase.expectedError;
                }
                equal(e.message, expectedError);
            }
            equal(expectedExceptionCaught, true);
        }
    });

    it("formats filters", function () {
        var query = { filters : "p1 eq 'test'" },
            result = formatSql.filter(query);
        equal(result.sql, "([p1] = @p1)");
        equal(result.parameters[0].name, 'p1')
        equal(result.parameters[0].value, 'test')
    });

    it("formats filters with custom parameter prefixes", function () {
        var query = { filters : "p1 eq 'test'" },
            result = formatSql.filter(query, 'z');
        equal(result.sql, "([p1] = @z1)");
        equal(result.parameters[0].name, 'z1')
    });

    function verifySqlFormatting(query, expectedSql, metadata) {
        if(metadata) metadata.schema = 'testapp';
        var statements = formatSql(query, metadata || { idType: "number", binaryColumns: [], schema: 'testapp' });

        var expectedStatements = expectedSql;
        if (expectedSql.constructor !== Array) {
            expectedStatements = [expectedSql];
        }

        for (var i = 0; i < statements.length; i++) {
            equal(statements[i].sql, expectedStatements[i]);
        }

        return statements;
    }
})
