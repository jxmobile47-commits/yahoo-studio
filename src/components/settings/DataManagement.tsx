'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardBody, Button, Divider } from '@heroui/react';
import { FiTrash2, FiDownload, FiHardDrive, FiRefreshCw } from 'react-icons/fi';

const STORAGE_KEYS = [
  { key: 'yahooStudio_beatmaker_autosave', label: 'Beat Maker Pattern' },
  { key: 'yahooStudio_vocalsynth_autosave', label: 'Vocal Synth Notes' },
  { key: 'yahooStudio_beat_detector', label: 'Beat Detector Preference' },
  { key: 'yahooStudio_chord_detector', label: 'Chord Detector Preference' },
];

interface StorageItem {
  key: string;
  label: string;
  size: number;
  exists: boolean;
}

function getStorageInfo(): StorageItem[] {
  if (typeof window === 'undefined') return [];
  return STORAGE_KEYS.map(({ key, label }) => {
    const value = localStorage.getItem(key);
    return {
      key,
      label,
      size: value ? new Blob([value]).size : 0,
      exists: !!value,
    };
  });
}

function getTotalLocalStorageSize(): number {
  if (typeof window === 'undefined') return 0;
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    const v = localStorage.getItem(k) || '';
    total += new Blob([k + v]).size;
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function DataManagement() {
  const [items, setItems] = useState<StorageItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const refresh = () => {
    setItems(getStorageInfo());
    setTotalSize(getTotalLocalStorageSize());
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleClearItem = (key: string) => {
    localStorage.removeItem(key);
    refresh();
  };

  const handleClearAll = () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      setTimeout(() => setConfirmClearAll(false), 3000);
      return;
    }
    STORAGE_KEYS.forEach(({ key }) => localStorage.removeItem(key));
    setConfirmClearAll(false);
    refresh();
  };

  const handleExportAll = () => {
    const data: Record<string, unknown> = {};
    STORAGE_KEYS.forEach(({ key }) => {
      const v = localStorage.getItem(key);
      if (v) {
        try { data[key] = JSON.parse(v); } catch { data[key] = v; }
      }
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yahoo-studio-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 pt-1">
      <Card shadow="sm" className="border border-gray-200 dark:border-gray-700">
        <CardBody className="p-4 gap-4">
          {/* Storage Summary */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <FiHardDrive className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Total Storage Used</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatBytes(totalSize)} of ~5 MB browser limit
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="flat"
              startContent={<FiRefreshCw className="w-3.5 h-3.5" />}
              onPress={refresh}
            >
              Refresh
            </Button>
          </div>

          <Divider />

          {/* Saved Items */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Saved Data
            </h4>
            {items.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800/50"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {item.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {item.exists ? formatBytes(item.size) : 'No data saved'}
                  </p>
                </div>
                {item.exists && (
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isIconOnly
                    onPress={() => handleClearItem(item.key)}
                    aria-label={`Clear ${item.label}`}
                  >
                    <FiTrash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <Divider />

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              size="md"
              variant="flat"
              color="primary"
              startContent={<FiDownload className="w-4 h-4" />}
              onPress={handleExportAll}
              className="flex-1"
            >
              Export Backup (JSON)
            </Button>
            <Button
              size="md"
              variant="flat"
              color="danger"
              startContent={<FiTrash2 className="w-4 h-4" />}
              onPress={handleClearAll}
              className="flex-1"
            >
              {confirmClearAll ? 'Click again to confirm' : 'Clear All Data'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
