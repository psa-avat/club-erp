
This files describe the main menu of ERP_CLUB.

This menu is based on already exiting part and future ones.
I have tried to split the functionnalities into modules.

We'll keep the existing modules  :
    - Admin : administration tasks
    - assets: management of flying and non flying assets
    - banque: all bank related functions
    - club  : club management
    - dashboard : general dashboard module
    - flights : 
    - helloasso :
    - members:
    - members-portal
    - planche
    - princing :
    - storage :
    - vi : (vol d'initiation)

# ERP CLUB

## architecture

    - database : postgres
    - backend  : python + fastapi
    - frontend : react + vite
    - storage  : S3 / rustfs

    Each component is embeded in a docker container.

### External tools 

    - Planche  : APP developped by ourselves that handles the flights tracking. This app need to know pilots, machines and active vouchers sold ( ERP source of truth) and provides validated flights with all the informations ( Planche is the source of truth)
    - Gesasso  : this is a federal software to which we send validated flight once integrated into the ERP ( pilots license validity)
    - OSRT     : this is a federal software to which we send validated flight time by machine ( aeroworthiness )
    - HELLOASSO: External software from which initiation flight are bought ( vouchers)
    - Click&Glide : Extenal software that manages activity schedule ( to be feeded by ERP or to be replaced ? )

## functionnalities

    The main goals of ERP CLUB is to facilitate a glider club management. 
    It can be used by dedicated users and has a member portal.

    We need to have the following functions :

### members management

    Members should be registered for the current year to practice an activity. We have full members, temporary members, non flying members, short period, volunteer , external , business 
    Registered members pay a subscription fee for the year. If it subscibes from the 1st of october, it'll be registered for the full following year too.

    - member directory : we have 3 types of members :  core members, external members (clubs ...), business members ( suppliers)
    - member registration management (active members)
    - member anonymisation (unregistred members)

    - member balance sheet
    - member logbook
    - member expense

    members are pushed to the planche which is using them in flights declarations. 

### committes 

    We manage committees. 
    A committee has members, a responsble, actions and a budget

### Asset management 

    We define asset types and assets. Some asset are private gliders. For club gliders we also follow the depreciation of the asset.
    
    Assets are pushed to the planche which is using them in flights declarations. 

### Prices 

    Prices are associated to an asset type or are general.
    Prices have a version and an application date range. Prices can change during the year.
    We also manage packs that offer discounts on the flights prices. Packs have a start application date. Packs can't cross a fiscal year.


### flights 

    Flights are synchronized ( pulled) from the planche and stored into the ERP database.
    If flights are modified on the planche side they are pulled again with a revision.
    Flight are billed on the price gross base and discounts are applied separately. Pack can be purshased after a flight is billed.


### Finance & accounting

    We need to manage a ledger with different journals.
    Entries can be in drat or posted mode.
    We need to have KPI and finacial reports
    We manage a french PCG 
    We have bank accounts to follow ( + reconciliation )
    We need entries model
    We need to manage recuring operations
    Budget definition : we have the current bugdet prepared for the fiscal year and one for the next fiscal year.
    Budget reports or KPI


### Employees

    We need to register accounting entries for charges , salaries ...
    We need to manage a leave workflow with authorization, a schedule 
    We need to register the activitie ( hours made by day)

### activitie

    We need to have an activities schedule module

### members portal

    Each member can access to a external portal
    this portal provides : logbook, balance sheet , expenses for the club , volunteer expense (for fiscal discount), account charging function

### sales & suppliers

    We need to sell items to ours members 
    We need to register suppliers invoices and payments 



## Main menu

- Dashboard  
    -Members
    -Assets
    -Flights
    -Accounting


-Club
    -Members
      -Member sheet ( logbook / balance / Expenses / Volunteer / Documents)  ==> link to external portal
    -Assets
        -type of assets
        -asset list
    -Committes
        -Committes + link with members

    -Employees  ( do we need an external portal acces ?)
        -Schedulle 
        -Leaves

    -Schedulle
        -Activities

        

-Flights
    -Flights ( billing)
    -Packs ( purchase / consumption / balance)
    -Initiation flights
        -Type of VI
        -Vouchers
        -Schedulle

-External tools
    -Planche
    -HelloAsso
    -Gesasso
    -OSRT
    -ClicknGlide

-Accounting
    -Charts of accounts
    -Fiscal years
    -Banck
        -accounts
        -Reconciliation & Alignment

    -Pricing
        -General settings
        -type of flights
        -Pricing ( asset or general)


    -Entries
        -models
        -Recurring operations

    -Journal 

    -Sales 
        -Sales

    -Suppliers
        -invoice

    -Financial reports 
        -Income statement
        -Balance sheet

-Admin
    -Users / roles /capabilities
    -Settings
        -storage
        -planche
        -helloasso
        -gesasso
        -email
        -osrt
        -clicknglide

    -Audit trail 




