# ASSETS

 Our main assets are the machines, gliders, tow planes and winch. These assets can be owned by the club or be privates ones.
 We also have other assets that we can follow engines, trailers 
 We have also some stocks fuel and maintenance products.

Prices are associated to machines assets. These prices are used to charge a pilot when he uses it.
Prices should have versions and price item with a type. I think that prices are related to an asset type / model instead of the asset.
For example 
Glider ASk21 ==> Price V1 from data, to date  ==> byFlightHours, Threshold, price, price with pack
Tow Plance ==> Price v1 ... ==> byEngineTime, threshold,...
Winch ==> Price v1 ... ==> byFlightDuration or byFlight , threshold, price ...

Tow plane have special prices depending on the kind of flight ( tow, ferry, ..)
Winch also can have different price depending on the kind of flight ( normal, cable break, exercise ..)
This kind of fligth should be set in a parameter table.

For prices, we also sell products or services. Should we store them in a price list

For main assets I have to follow immobilization and depreciation of the assets. That would appears in a balance account.
So I think that some asset should have an internal accountId as members have.

I need a set of table to handle that.

Keep in mind that all should be tracked in a ledger for accounting purposes. 
 