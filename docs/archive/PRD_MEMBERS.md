 # Members

  We are managing members. For each member we gather general informations.
  We have full members that subscribe for a year, temporay members that come to fly few days,
  non flying members, short period members ( 1 to 4 weeks), external pilots ( to be tracked?),
  
  We also have special members, staff executive and board (12 people), employees, flight instructors. A member can be executive and instructor or employee and instructor. Employees can't be staff executive or board.

  The account ID will be used to track expenses in the ledger.

  Members that fly should have a member sheet which will be a summary of is activity and will provide and external acces to his expenses
  
  We have committees that handle regular tasks. Each committes will have a bugdet to manage. Each member should belong at least at one committee. This is renewed each year during the registration process.

  Using this description and the example of data, design and produce the dedicated table store these informations. I'll need a members.sql to be injected in the database. 
  Design the backend functions too.
  Design the frontend related interfaces.


 ## Members Table fields
   - uuid
   - Genre
   - FirstName 
   - LastName
   - date of birth
   - email address
   - type of member : enumerate ( 1-Plain Member 2-Temporary Member 3-Volunteer  )
   - staff_function : emumerate (0-None 1-Employee 2-Executive 3-Board,)
   - Seniority 
   - FFVP id ( numerical) 
   - AccountId ( automatic ME<YEAR><chrono> ex ME2026-0001) Can be ajusted and must be unique. Used to member login ?
   - Phone number 
   - photo : small pic ?
   - is_active
   - status : SMALLINT DEFAULT 1; -- 1: Active, 2: Suspended, 3: Resigned, 4: Anonymized (GDPR)
   - created_at
   - update_at
   - updated_by (user)

## Committees
   - uuid
   - description
   - manager ==> member uuid

### Committees members
   - uuid ==> member uuid
   
## Member Sheet Table fields
   - uuid ==> member uuid
   - year
   - licence number
   - type of fare
   - Hours count
   - Number of packs bought
   - Hours done in pack
   - Remaining hours in pack
    
