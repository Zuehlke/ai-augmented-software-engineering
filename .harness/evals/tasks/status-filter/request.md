Support staff often look for one kind of flight only, for example the cancelled ones. `GET /delays` should
accept a `status` parameter, `on_time`, `delayed` or `cancelled`, in any case, and then return only the
flights whose current status is that. It works together with the existing `airline_code` filter. If no
flight has that status, the answer is an empty list. Any other status is a bad request.
