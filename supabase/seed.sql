-- Synthetic users are created through the local Auth admin API by the test harness.
-- No production fixture credentials or customer content are stored here.

-- This seed runs only in the explicitly isolated local stack. Remote enrollment stays closed.
update loopmark_private.availability set cloud_enrollment=true where id;
