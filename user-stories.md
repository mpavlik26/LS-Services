Background
  - As the manager of a group of developers who are on duty and responsible for keeping their services up and running, I want to automate the creation of the duty shift schedule for a given month.
  - There is always a Google Sheet containing a list of employees in rows and a list of days in columns (1–31, representing the day's position in the month; months with fewer than 31 days will have fewer columns).
    - The column containing employee names has an empty cell below the last employee's name.
  - Below each day number there is a row containing the Czech name of the day of the week.
    - Identifying weekends and public holidays is critical, as they are compensated with a special surcharge. The values "so" and "ne" identify Saturday and Sunday respectively, constituting a weekend. The value "sv" is used when a non-weekend date is a public holiday.
  - Before the month begins, employees fill in the Google Sheet with their availability using the following values at the intersection of their name and the day number:
    - "-" — I cannot be on duty
    - "*" — I can be on duty, but only as a last resort
    - "?" — I don't mind being on duty
    - "!" — I really want to be on duty
    - If the value at a given intersection is 1 (the number), the duty has already been manually assigned to that employee.
    - Other values may be present, but they play no role in the automatic duty distribution.
  - The basic row and column configuration should be stored as constants in the script so they can be changed in one place.
    - Default values:
      - Row with day numbers: 7
      - Row with Czech day-of-week names: 8
      - First row with employee names: 9
      - Column with employee names: 2
      - Column for the first day of the month: 3

Epics:
  - E-1
    - As the manager, I want to be able to run a Google Apps Script that reads the Google Sheet and uses its values as input for an automatic engine that assigns employees to duty shifts for each day of the month.
    - The automatic engine follows the rules defined in the user stories below.
    - User stories:
      - E-1-US-1:
        - The automatic engine never assigns more than one employee to duty for a given day. Duty can be assigned manually in the sheet to multiple employees, but the engine will never add another assignment on top of an existing one — if one or more employees are already assigned to a day before the engine runs, the engine skips that day.
        - When the script runs, the automatic engine goes through the sheet and assigns duty (by replacing the cell value with 1) to the employee who wants to be on duty.
        - When multiple employees want to be on duty on the same day, the engine distributes assignments fairly by taking into account the total number of days each employee has expressed willingness to work. The more days an employee is willing to work, the more duty assignments they should receive — proportionally, where possible.
          - Example:
            - If employee "filip" is willing to work 10 days and employee "brut" is willing to work only 5 days, the engine should assign approximately twice as many duty shifts to "filip" as to "brut", reflecting their respective willingness ratio.

