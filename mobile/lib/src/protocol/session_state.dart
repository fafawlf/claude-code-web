enum PermissionMode {
  default_('default'),
  acceptEdits('acceptEdits'),
  plan('plan'),
  bypassPermissions('bypassPermissions');

  const PermissionMode(this.wire);
  final String wire;

  String toJson() => wire;

  static PermissionMode fromJson(String s) {
    for (final v in values) {
      if (v.wire == s) return v;
    }
    throw FormatException('Unknown PermissionMode: $s');
  }
}

enum SessionRuntimeStatus {
  idle,
  running,
  waitingPermission,
  waitingPlan,
  error,
  closed;

  String toJson() => switch (this) {
        SessionRuntimeStatus.idle => 'idle',
        SessionRuntimeStatus.running => 'running',
        SessionRuntimeStatus.waitingPermission => 'waiting_permission',
        SessionRuntimeStatus.waitingPlan => 'waiting_plan',
        SessionRuntimeStatus.error => 'error',
        SessionRuntimeStatus.closed => 'closed',
      };

  static SessionRuntimeStatus fromJson(String s) => switch (s) {
        'idle' => SessionRuntimeStatus.idle,
        'running' => SessionRuntimeStatus.running,
        'waiting_permission' => SessionRuntimeStatus.waitingPermission,
        'waiting_plan' => SessionRuntimeStatus.waitingPlan,
        'error' => SessionRuntimeStatus.error,
        'closed' => SessionRuntimeStatus.closed,
        _ => throw FormatException('Unknown SessionRuntimeStatus: $s'),
      };
}

class ActiveToolInfo {
  const ActiveToolInfo({
    required this.toolUseId,
    required this.name,
    required this.startedAt,
    this.inputSummary,
  });

  final String toolUseId;
  final String name;
  final int startedAt;
  final String? inputSummary;

  factory ActiveToolInfo.fromJson(Map<String, dynamic> json) => ActiveToolInfo(
        toolUseId: json['toolUseId'] as String,
        name: json['name'] as String,
        startedAt: (json['startedAt'] as num).toInt(),
        inputSummary: json['inputSummary'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'toolUseId': toolUseId,
        'name': name,
        'startedAt': startedAt,
        if (inputSummary != null) 'inputSummary': inputSummary,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ActiveToolInfo &&
          runtimeType == other.runtimeType &&
          toolUseId == other.toolUseId &&
          name == other.name &&
          startedAt == other.startedAt &&
          inputSummary == other.inputSummary;

  @override
  int get hashCode => Object.hash(toolUseId, name, startedAt, inputSummary);
}

class SessionStateSnapshot {
  const SessionStateSnapshot({
    required this.sessionId,
    required this.cwd,
    required this.permissionMode,
    required this.runtimeStatus,
    required this.attachedCount,
    required this.lastEventId,
    required this.lastEventAt,
    required this.tokensIn,
    required this.tokensOut,
    this.claudeSessionId,
    this.model,
    this.activeTool,
    this.cost,
    this.viewerMode,
  });

  final String sessionId;
  final String? claudeSessionId;
  final String cwd;
  final String? model;
  final PermissionMode permissionMode;
  final SessionRuntimeStatus runtimeStatus;
  final int attachedCount;
  final int lastEventId;
  final int lastEventAt;
  final ActiveToolInfo? activeTool;
  final int tokensIn;
  final int tokensOut;
  final double? cost;
  final bool? viewerMode;

  factory SessionStateSnapshot.fromJson(Map<String, dynamic> json) => SessionStateSnapshot(
        sessionId: json['sessionId'] as String,
        claudeSessionId: json['claudeSessionId'] as String?,
        cwd: json['cwd'] as String,
        model: json['model'] as String?,
        permissionMode: PermissionMode.fromJson(json['permissionMode'] as String),
        runtimeStatus: SessionRuntimeStatus.fromJson(json['runtimeStatus'] as String),
        attachedCount: (json['attachedCount'] as num).toInt(),
        lastEventId: (json['lastEventId'] as num).toInt(),
        lastEventAt: (json['lastEventAt'] as num).toInt(),
        activeTool: json['activeTool'] == null
            ? null
            : ActiveToolInfo.fromJson(json['activeTool'] as Map<String, dynamic>),
        tokensIn: (json['tokensIn'] as num).toInt(),
        tokensOut: (json['tokensOut'] as num).toInt(),
        cost: (json['cost'] as num?)?.toDouble(),
        viewerMode: json['viewerMode'] as bool?,
      );

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        if (claudeSessionId != null) 'claudeSessionId': claudeSessionId,
        'cwd': cwd,
        if (model != null) 'model': model,
        'permissionMode': permissionMode.toJson(),
        'runtimeStatus': runtimeStatus.toJson(),
        'attachedCount': attachedCount,
        'lastEventId': lastEventId,
        'lastEventAt': lastEventAt,
        if (activeTool != null) 'activeTool': activeTool!.toJson(),
        'tokensIn': tokensIn,
        'tokensOut': tokensOut,
        if (cost != null) 'cost': cost,
        if (viewerMode != null) 'viewerMode': viewerMode,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SessionStateSnapshot &&
          runtimeType == other.runtimeType &&
          sessionId == other.sessionId &&
          claudeSessionId == other.claudeSessionId &&
          cwd == other.cwd &&
          model == other.model &&
          permissionMode == other.permissionMode &&
          runtimeStatus == other.runtimeStatus &&
          attachedCount == other.attachedCount &&
          lastEventId == other.lastEventId &&
          lastEventAt == other.lastEventAt &&
          activeTool == other.activeTool &&
          tokensIn == other.tokensIn &&
          tokensOut == other.tokensOut &&
          cost == other.cost &&
          viewerMode == other.viewerMode;

  @override
  int get hashCode => Object.hash(
        sessionId,
        claudeSessionId,
        cwd,
        model,
        permissionMode,
        runtimeStatus,
        attachedCount,
        lastEventId,
        lastEventAt,
        activeTool,
        tokensIn,
        tokensOut,
        cost,
        viewerMode,
      );

  SessionStateSnapshot copyWith({
    String? sessionId,
    String? claudeSessionId,
    String? cwd,
    String? model,
    PermissionMode? permissionMode,
    SessionRuntimeStatus? runtimeStatus,
    int? attachedCount,
    int? lastEventId,
    int? lastEventAt,
    ActiveToolInfo? activeTool,
    int? tokensIn,
    int? tokensOut,
    double? cost,
    bool? viewerMode,
  }) {
    return SessionStateSnapshot(
      sessionId: sessionId ?? this.sessionId,
      claudeSessionId: claudeSessionId ?? this.claudeSessionId,
      cwd: cwd ?? this.cwd,
      model: model ?? this.model,
      permissionMode: permissionMode ?? this.permissionMode,
      runtimeStatus: runtimeStatus ?? this.runtimeStatus,
      attachedCount: attachedCount ?? this.attachedCount,
      lastEventId: lastEventId ?? this.lastEventId,
      lastEventAt: lastEventAt ?? this.lastEventAt,
      activeTool: activeTool ?? this.activeTool,
      tokensIn: tokensIn ?? this.tokensIn,
      tokensOut: tokensOut ?? this.tokensOut,
      cost: cost ?? this.cost,
      viewerMode: viewerMode ?? this.viewerMode,
    );
  }
}

class SessionStatePatch {
  const SessionStatePatch({
    this.sessionId,
    this.claudeSessionId,
    this.cwd,
    this.model,
    this.permissionMode,
    this.runtimeStatus,
    this.attachedCount,
    this.lastEventId,
    this.lastEventAt,
    this.activeTool,
    this.tokensIn,
    this.tokensOut,
    this.cost,
    this.viewerMode,
  });

  final String? sessionId;
  final String? claudeSessionId;
  final String? cwd;
  final String? model;
  final PermissionMode? permissionMode;
  final SessionRuntimeStatus? runtimeStatus;
  final int? attachedCount;
  final int? lastEventId;
  final int? lastEventAt;
  final ActiveToolInfo? activeTool;
  final int? tokensIn;
  final int? tokensOut;
  final double? cost;
  final bool? viewerMode;

  factory SessionStatePatch.fromJson(Map<String, dynamic> json) => SessionStatePatch(
        sessionId: json['sessionId'] as String?,
        claudeSessionId: json['claudeSessionId'] as String?,
        cwd: json['cwd'] as String?,
        model: json['model'] as String?,
        permissionMode: json.containsKey('permissionMode')
            ? PermissionMode.fromJson(json['permissionMode'] as String)
            : null,
        runtimeStatus: json.containsKey('runtimeStatus')
            ? SessionRuntimeStatus.fromJson(json['runtimeStatus'] as String)
            : null,
        attachedCount: (json['attachedCount'] as num?)?.toInt(),
        lastEventId: (json['lastEventId'] as num?)?.toInt(),
        lastEventAt: (json['lastEventAt'] as num?)?.toInt(),
        activeTool: json['activeTool'] == null
            ? null
            : ActiveToolInfo.fromJson(json['activeTool'] as Map<String, dynamic>),
        tokensIn: (json['tokensIn'] as num?)?.toInt(),
        tokensOut: (json['tokensOut'] as num?)?.toInt(),
        cost: (json['cost'] as num?)?.toDouble(),
        viewerMode: json['viewerMode'] as bool?,
      );

  Map<String, dynamic> toJson() => {
        if (sessionId != null) 'sessionId': sessionId,
        if (claudeSessionId != null) 'claudeSessionId': claudeSessionId,
        if (cwd != null) 'cwd': cwd,
        if (model != null) 'model': model,
        if (permissionMode != null) 'permissionMode': permissionMode!.toJson(),
        if (runtimeStatus != null) 'runtimeStatus': runtimeStatus!.toJson(),
        if (attachedCount != null) 'attachedCount': attachedCount,
        if (lastEventId != null) 'lastEventId': lastEventId,
        if (lastEventAt != null) 'lastEventAt': lastEventAt,
        if (activeTool != null) 'activeTool': activeTool!.toJson(),
        if (tokensIn != null) 'tokensIn': tokensIn,
        if (tokensOut != null) 'tokensOut': tokensOut,
        if (cost != null) 'cost': cost,
        if (viewerMode != null) 'viewerMode': viewerMode,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SessionStatePatch &&
          runtimeType == other.runtimeType &&
          sessionId == other.sessionId &&
          claudeSessionId == other.claudeSessionId &&
          cwd == other.cwd &&
          model == other.model &&
          permissionMode == other.permissionMode &&
          runtimeStatus == other.runtimeStatus &&
          attachedCount == other.attachedCount &&
          lastEventId == other.lastEventId &&
          lastEventAt == other.lastEventAt &&
          activeTool == other.activeTool &&
          tokensIn == other.tokensIn &&
          tokensOut == other.tokensOut &&
          cost == other.cost &&
          viewerMode == other.viewerMode;

  @override
  int get hashCode => Object.hash(
        sessionId,
        claudeSessionId,
        cwd,
        model,
        permissionMode,
        runtimeStatus,
        attachedCount,
        lastEventId,
        lastEventAt,
        activeTool,
        tokensIn,
        tokensOut,
        cost,
        viewerMode,
      );

  SessionStateSnapshot applyTo(SessionStateSnapshot base) {
    return base.copyWith(
      sessionId: sessionId,
      claudeSessionId: claudeSessionId,
      cwd: cwd,
      model: model,
      permissionMode: permissionMode,
      runtimeStatus: runtimeStatus,
      attachedCount: attachedCount,
      lastEventId: lastEventId,
      lastEventAt: lastEventAt,
      activeTool: activeTool,
      tokensIn: tokensIn,
      tokensOut: tokensOut,
      cost: cost,
      viewerMode: viewerMode,
    );
  }
}
