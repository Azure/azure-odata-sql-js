# azure-odata-sql

This library contains functionality to convert OData queries into SQL
statements.

The library uses types from the `mssql` npm package to represent parameter types.
The query object is in the format produced by
[azure-query-js](https://github.com/Azure/queryjs).

## Installation

    npm i azure-odata-sql

## Usage

The library currently exports a single function:

    require('azure-odata-sql').format(query, tableConfig)

The query parameter is an object with any of the following properties:

|Property|Description|
|--------|-----------|
|skip|Number of rows to skip|
|take|Number of rows to take|
|inlineCount|Set to `allpages` to include a total count query|
|resultLimit|Number of rows to limit the query to|
|selections|Columns to select|
|filters|Filters to apply|
|ordering|Columns to sort by|
|id|Record identifier|
|includeDeleted|Include soft deleted columns|

The tableConfig is an object with any of the following properties:

|Property|Description|
|--------|-----------|
|name|The name of the table being queried|
|schema|The database schema name for the table|
|flavor|Either `mssql` or `sqlite`|
|softDelete|True if the table supports soft delete with a column called `deleted`|
