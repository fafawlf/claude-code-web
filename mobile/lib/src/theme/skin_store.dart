import '../profiles/profile_store.dart';
import 'skin_palette.dart';

/// Persists the user's skin choice in the same secure storage we use for
/// everything else, so there's no second backing store to wire up.
class SkinStore {
  SkinStore(this._kv);
  final SecureKeyValueStore _kv;

  static const String _key = 'ccw_skin.v1';

  Future<SkinId> read() async {
    final String? raw = await _kv.read(_key);
    return skinIdFromString(raw) ?? kDefaultSkin;
  }

  Future<void> write(SkinId id) async {
    await _kv.write(_key, skinIdToString(id));
  }
}
