#!/bin/bash
set -u

payload="$(cat)" || exit 0

if ! output="$(
	printf '%s' "$payload" | jq -r '
		def clean_text:
			if type == "string" then gsub("[\\r\\n\\t]"; " ") | gsub("  +"; " ") else "" end;

		def remaining_percent:
			if (.remaining_fraction | type) == "number" then
				([0, ([100, (.remaining_fraction * 100)] | min)] | max | round | tostring) + "%"
			else
				"--"
			end;

		def reset_seconds:
			. as $quota
			| if (.reset_time | type) == "string" then
				try ((.reset_time | fromdateiso8601) - now) catch ($quota.reset_in_seconds // null)
			  elif (.reset_in_seconds | type) == "number" then
				.reset_in_seconds
			  else
				null
			  end;

		def duration:
			([0, .] | max | floor) as $seconds
			| if $seconds < 60 then
				"<1m"
			  elif $seconds < 3600 then
				(($seconds / 60 | floor | tostring) + "m")
			  elif $seconds < 86400 then
				($seconds / 3600 | floor) as $hours
				| (($seconds % 3600) / 60 | floor) as $minutes
				| ($hours | tostring) + "h" + (if $minutes > 0 then " " + ($minutes | tostring) + "m" else "" end)
			  else
				($seconds / 86400 | floor) as $days
				| (($seconds % 86400) / 3600 | floor) as $hours
				| ($days | tostring) + "d" + (if $hours > 0 then " " + ($hours | tostring) + "h" else "" end)
			  end;

		def quota($key; $label):
			.quota[$key] as $quota
			| if ($quota | type) == "object" then
				($label + " " + ($quota | remaining_percent))
				+ (($quota | reset_seconds) as $seconds
					| if ($seconds | type) == "number" then " ↻ " + ($seconds | duration) else "" end)
			  else
				$label + " --"
			  end;

		(.model.display_name // .model.id // "agy" | clean_text) as $model
		| quota("gemini-5h"; "5H") as $five_hour
		| quota("gemini-weekly"; "7D") as $weekly
		| (($five_hour + " │ " + $weekly)) as $limits
		| ((.terminal_width // 80) | if type == "number" then floor else 80 end | if . < 1 then 80 else . end) as $width
		| ($model + " │ " + $limits) as $full
		| if ($full | length) <= $width then
			$full
		  elif ($width - ($limits | length) - 3) >= 8 then
			($width - ($limits | length) - 3) as $model_width
			| ($model[0:($model_width - 1)] + "… │ " + $limits)
		  elif ($limits | length) <= $width then
			$limits
		  elif $width > 1 then
			$limits[0:($width - 1)] + "…"
		  else
			$limits[0:$width]
		  end
	' 2>/dev/null
)"; then
	output="agy │ 5H -- │ 7D --"
fi

printf '%s\n' "$output"
