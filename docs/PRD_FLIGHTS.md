The planche de vol project is connected to erp-club.
Planche app should synchronise pilots and machine using the ERP api. This will be done on demand or on schedule.
As we are migrating between 2 systems will add new ids in the planche app for pilots and assets. These IDs can be the member ID and the asset code.

The ERP must also retrieve validated flights from Planche de vol to compute flights prices and affect them to the right member. Flights on the planche side have and uuid that can help to identify then.
In planche admin console, there is a way to invalidate flights and validate them again. We need handle that to avoid to double charge a member. Maybe should we consider the way it is done by adding a state flag to a validated flight instead of deleting it?

The ERP will store the flights on its side too.  The import will be on demand only. We'll ask for flights updated since the last update. We also can implement a check message to retrieve the number of flights in each systems and compare them.

A flight on the ERP side can be modified as long as the accounting entry is in draft mode. Once validated the flight modification implies an account entry that cancel the operation and proceed to a new one. A full comment and a specific access level are mandatory to do that.

Will have a screen with the aircraft asset list will show for each aircraft the flight activity as well as the accounting balance. A detailed view of income and expenses grouped by members or type is also available.