-- Runs once, on the very first boot of the container.
-- A separate database for the integration tests, so running tests never wipes your dev data.
CREATE DATABASE practice_test OWNER practice;
