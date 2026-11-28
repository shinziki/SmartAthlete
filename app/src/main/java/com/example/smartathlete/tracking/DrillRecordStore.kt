package com.example.smartathlete.tracking

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

/**
 * Drill records made while the phone was out of range, kept on the watch until the
 * phone confirms it has them (DRILL_ACK). Stored in SharedPreferences so they survive
 * the watch app being closed before the phone comes back.
 */
class DrillRecordStore(context: Context) {

    companion object {
        private const val PREFS = "smartathlete_drill_records"
        private const val KEY = "pending"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Number of records waiting for the phone (Compose-observable, for the watch UI). */
    var pendingCount by mutableIntStateOf(load().size)
        private set

    private fun load(): MutableList<JSONObject> = try {
        val arr = JSONArray(prefs.getString(KEY, "[]"))
        MutableList(arr.length()) { arr.getJSONObject(it) }
    } catch (_: Exception) {
        mutableListOf()
    }

    private fun save(list: List<JSONObject>) {
        prefs.edit().putString(KEY, JSONArray(list).toString()).apply()
        pendingCount = list.size
    }

    private fun sameDrill(a: JSONObject, sid: String, index: Int) =
        a.optString("sid") == sid && a.optInt("i", -1) == index

    /** Adds a record, replacing an older one for the same session and drill. */
    fun add(record: JSONObject) {
        val sid = record.optString("sid")
        val index = record.optInt("i", -1)
        save(load().filterNot { sameDrill(it, sid, index) } + record)
    }

    /** Oldest record still waiting, or null. */
    fun next(): JSONObject? = load().firstOrNull()

    /** The phone has this record; drop it. */
    fun ack(sid: String, index: Int) {
        val list = load()
        val kept = list.filterNot { sameDrill(it, sid, index) }
        if (kept.size != list.size) save(kept)
    }
}
