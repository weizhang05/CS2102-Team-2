console.log("in the admins");

const user_search = document.getElementById("search-users-input");
const user_display = document.getElementById("users-display");
const user_count = document.getElementById("user-count");

function closeAlert() {
    var x = document.getElementById("success-alert");
    x.remove();
}

$(document).ready(function () {
    $('#delete-user-id').on('change', function() {
        var temp = $('#delete-user-id :selected').text();
        console.log(temp);
        var userName = $("td:contains('" + temp + "')").parent().find("td").eq(1).text();
        console.log(userName);
        $("#user-name").val(userName);
    })
});

user_search.addEventListener('input', function(event) {
    const search_txt = user_search.value.toLowerCase();
    const tbody = user_display.tBodies[0];
    let matches = 0;
    for (const row of tbody.rows) {
        let found = false;
        for (const cell of row.cells) {
            if (cell.textContent.toLowerCase().search(search_txt) >= 0) {
                found = true;
                matches += 1;
                break;
            }
        }
        row.style.display = found ? "" : "none";
    }
    user_count.textContent = matches;
});

