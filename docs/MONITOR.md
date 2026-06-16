# Stat Monitor Commands Guide

This guide describes how to use the `!monitor` (or `!watch`) commands to track Hypixel player game statistics.

## Commands List

### Add a Monitor
* Command: `!monitor add <player> <game> <stat> [threshold]`
* Example (Smart Mode): `!monitor add beenycool bedwars wins`
* Example (Custom Threshold): `!monitor add beenycool bedwars wins 10`
* Description: Starts tracking a player's stat. By default, it uses the smart auto-adjusting threshold. You can optionally specify a positive number at the end to notify only when the stat increases by at least that value.

### Remove a Monitor
* Command: `!monitor remove <player> <game> <stat>`
* Example: `!monitor remove beenycool bedwars wins`
* Description: Stops monitoring the player's stat.

### List Active Monitors
* Command: `!monitor list`
* Example: `!monitor list`
* Description: Lists all of your active monitors, showing their current values and set thresholds.

### Set Threshold
* Command: `!monitor threshold <player> <game> <stat> <value|auto>`
* Example (Custom): `!monitor threshold beenycool bedwars wins 20`
* Example (Auto): `!monitor threshold beenycool bedwars wins auto`
* Description: Changes the notification threshold of an existing monitor. Setting it to "auto" reverts it back to the smart auto-adjusting threshold.

## Supported Games
* bedwars
* buildbattle
* blitz
* cops
* duels
* megawalls
* murdermystery
* paintball
* pit
* quakecraft
* smash
* skywars
* tntgames
* uhc
* woolwars
