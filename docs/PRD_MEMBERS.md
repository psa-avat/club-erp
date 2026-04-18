 # Members

 ## Members Table fields
   - uuid
   - Genre
   - FirstName 
   - LastName
   - date of birth
   - email address
   - type of member ( empolyee,pilot,volunteer ?)
   - year of subsciption
   - Seniority ?
   - FFVP id ( numerical) 
   - AccountId ( automatic MEM<YEAR><chrono> ex MEM2026-0001) Can be ajusted and must be unique. Used to member login ?
   - Phone number 
   - bank account ? IBAN ?
   - photo ? 
   - 

Can we use the accountId as a uuid ?
Be carreful with RGPD rules and use appropriate storing methods

## Pilots Sheet Table fields
   - uuid
   - year
   - type of fare
   - Hours count
   - Number of packs bought
   - Hours done in pack
   - Remaining hours in pack
    
Is the table using partitions ?