#!/bin/bash
$user="erpuser"
$db="erp_club_db"

cat /tmp/erp.sql | sudo docker exec -i carnet-db psql -U $user -d $db 
cat /tmp/members.sql | sudo docker exec -i carnet-db psql -U $user -d $db 
cat /tmp/account.sql | sudo docker exec -i carnet-db psql -U $user -d $db 
cat /tmp/assets.sql | sudo docker exec -i carnet-db psql -U $user -d $db
